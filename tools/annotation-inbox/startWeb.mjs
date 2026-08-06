import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, [".annotation-inbox-build/tools/annotation-inbox/start.js"], { stdio: "inherit" }),
  spawn("npx", ["expo", "start", "--web"], { stdio: "inherit" }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code, signal) => {
    if (!stopping) stop(signal ? 1 : code ?? 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
