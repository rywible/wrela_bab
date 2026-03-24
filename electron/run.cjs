const path = require("node:path");
const { spawn } = require("node:child_process");
const electronBinary = require("electron");

const ROOT = path.resolve(__dirname, "..");
const MAIN = path.resolve(__dirname, "main.cjs");

const electronProcess = spawn(electronBinary, [MAIN], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

electronProcess.once("exit", (code) => {
  process.exit(code ?? 0);
});
