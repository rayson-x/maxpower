# Equipment video annotation lab

本机视频器械标注工具。它只读视频；逐帧标注写入浏览器 `localStorage`，只有用户点击“导出全部 JSON”时才生成可交付文件。

## 启动

```bash
node tools/equipment-video-annotation/server.mjs
```

浏览器打开 `http://127.0.0.1:4321`。当治理清单尚未生成时，页面会明确显示阻塞，但仍允许临时打开本地视频来验证标注交互。

## 合规视频清单

默认从下面的忽略目录读取：

```text
tools/equipment-video-annotation/workspace/manifest.json
```

也可以通过环境变量指定：

```bash
MAXPOWER_EQUIPMENT_VIDEO_MANIFEST=/absolute/path/to/manifest.json \
  node tools/equipment-video-annotation/server.mjs
```

清单格式：

```json
{
  "schemaVersion": "maxpower-equipment-video-manifest/v1",
  "manifestId": "governed-personal-equipment-v1",
  "status": "ready",
  "blockers": [],
  "videos": [
    {
      "id": "stable-video-id",
      "assetId": "catalog-asset-id",
      "sourceGroupKey": "participant/session/capture/device",
      "captureId": "capture-id",
      "videoSha256": "64-character-sha256",
      "sourcePath": "/absolute/private/video/path.mp4",
      "title": "杠铃卧推 · 正面",
      "exercise": "barbell_bench_press",
      "view": "front",
      "admissionState": "immutable_source",
      "repRanges": [{ "startMs": 1200, "endMs": 3100 }]
    }
  ]
}
```

`sourcePath` 仅由本机服务器读取，不会返回给浏览器或写入导出的标注 JSON。清单必须由通过审计的数据治理目录生成；工具不会递归发现视频。

## 标注合同

- 杠铃杆使用归一化视频坐标的两个轴线端点。
- 哑铃使用归一化视频坐标的 bbox，单帧最多 8 个实例。
- `reflection_only`、`static_rack_only` 与 `no_target_equipment` 是无正实例的硬负样本。
- `ambiguous` 保留人工不确定性，不得进入训练监督。
- 同一时间点重复保存会更新该帧草稿，不会制造重复标签。
- 导出文件保留 asset、source group、capture、hash、动作和机位身份；它本身不自动获得训练准入。

## 测试

```bash
node --test \
  tools/equipment-video-annotation/annotationDocument.test.mjs \
  tools/equipment-video-annotation/server.test.mjs
```
