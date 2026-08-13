import { resolve } from "node:path";

import { createAnnotationInboxServer } from "./server";

const projectRoot = process.cwd();
const inboxRoot = resolve(process.env.MAXPOWER_ANNOTATION_INBOX_DIR ?? "../new-video");
const archiveRoot = resolve(process.env.MAXPOWER_CONFIRMED_ARCHIVE_DIR ?? "public/archives/confirmed-captures");
const port = 4317;
const server = createAnnotationInboxServer({ inboxRoot, archiveRoot });

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[annotation-inbox] ${inboxRoot} -> ${archiveRoot} on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
