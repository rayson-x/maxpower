import assert from "node:assert/strict";
import test from "node:test";

import {
  FileBackedMediaBlobStore,
  InMemoryMediaBlobStore,
  type MediaFileStoragePort,
  sha256Hex,
} from "../../src/privacy";

test("MediaBlobStore 为相同字节生成稳定的内容地址，并且不会跨本地用户读取", async () => {
  const media = new InMemoryMediaBlobStore({ now: () => "2026-08-09T08:00:00.000Z" });
  const bytes = new TextEncoder().encode("meal-photo-bytes");

  const first = await media.put({ userId: "user-a", mimeType: "image/jpeg", bytes });
  const duplicate = await media.put({ userId: "user-a", mimeType: "image/jpeg", bytes: new Uint8Array(bytes) });

  assert.equal(first.id, duplicate.id);
  assert.equal(first.contentHash, duplicate.contentHash);
  assert.equal(first.encryption, "not_encrypted");
  assert.equal((await media.get({ userId: "user-b", id: first.id })), null);
  assert.deepEqual(await media.get({ userId: "user-a", id: first.id }), {
    reference: first,
    bytes,
  });
});

test("MediaBlobStore 的删除留下本地生命周期墓碑，并且不会删除另一用户的同内容副本", async () => {
  const media = new InMemoryMediaBlobStore({ now: () => "2026-08-09T08:00:00.000Z" });
  const bytes = new TextEncoder().encode("same-content");
  const first = await media.put({ userId: "user-a", mimeType: "image/png", bytes });
  const second = await media.put({ userId: "user-b", mimeType: "image/png", bytes });

  assert.equal(first.id, second.id);
  await media.delete({ userId: "user-a", id: first.id });

  assert.equal(await media.get({ userId: "user-a", id: first.id }), null);
  assert.deepEqual(await media.reference({ userId: "user-a", id: first.id }), {
    ...first,
    lifecycle: "deleted",
    updatedAt: "2026-08-09T08:00:00.000Z",
  });
  assert.deepEqual((await media.get({ userId: "user-b", id: second.id }))?.bytes, bytes);
  assert.equal((await media.list({ userId: "user-a", lifecycle: "deleted" })).length, 1);
});

test("MediaBlobStore 使用 SHA-256 内容哈希，而不是调用方提供的可伪造 id", () => {
  assert.equal(
    sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("文件后端跨重启保留墓碑和内容校验索引，且索引不写入明文 user ID", async () => {
  const storage = new MemoryFiles();
  const options = {
    storage,
    root: "maxpower-media-v1",
    now: () => "2026-08-09T08:00:00.000Z",
    encryption: "platform_protected" as const,
  };
  const first = new FileBackedMediaBlobStore(options);
  const ref = await first.put({
    userId: "private-local-user",
    mimeType: "image/jpeg",
    bytes: new TextEncoder().encode("persisted-local-media"),
  });
  const manifest = new TextDecoder().decode(storage.contents("maxpower-media-v1/manifest-v1.json")!);
  assert.equal(manifest.includes("private-local-user"), false);

  const restarted = new FileBackedMediaBlobStore(options);
  assert.equal((await restarted.get({ userId: "private-local-user", id: ref.id }))?.reference.encryption, "platform_protected");
  await restarted.delete({ userId: "private-local-user", id: ref.id });

  const afterRestart = new FileBackedMediaBlobStore(options);
  assert.equal(await afterRestart.get({ userId: "private-local-user", id: ref.id }), null);
  assert.equal((await afterRestart.reference({ userId: "private-local-user", id: ref.id }))?.lifecycle, "deleted");
});

class MemoryFiles implements MediaFileStoragePort {
  private readonly files = new Map<string, Uint8Array>();

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, new Uint8Array(bytes));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  contents(path: string): Uint8Array | undefined {
    const bytes = this.files.get(path);
    return bytes ? new Uint8Array(bytes) : undefined;
  }
}
