#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FFI_FLAGS = ["--experimental-ffi", "--disable-warning=ExperimentalWarning"];
const FFI_MIN_NODE = [26, 4, 0];

function nodeAtLeast(min) {
  const parts = process.versions.node.split(".").map(Number);
  for (let i = 0; i < min.length; i++) {
    const have = parts[i] ?? 0;
    if (have !== min[i]) return have > min[i];
  }
  return true;
}

const underBun = Boolean(process.versions.bun);
const hasFlags = FFI_FLAGS.every((flag) => process.execArgv.includes(flag));

if (underBun || hasFlags || !nodeAtLeast(FFI_MIN_NODE)) {
  await import("../dist/index.js");
} else {
  const script = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const child = spawnSync(process.execPath, [...FFI_FLAGS, script, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  if (child.error) {
    console.error(child.error.message);
    process.exitCode = 1;
  } else if (child.signal) {
    process.kill(process.pid, child.signal);
  } else {
    process.exitCode = child.status ?? 1;
  }
}
