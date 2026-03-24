import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const OUTPUT_DIR = path.resolve(ROOT, "output/playwright");

function vpCommand() {
  return process.platform === "win32" ? "vp.cmd" : "vp";
}

function runCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "null"}`));
    });
  });
}

function waitForPort(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.end();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }

        setTimeout(tryConnect, 200);
      });
    };

    tryConnect();
  });
}

function getAvailablePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not resolve an available port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await runCommand(vpCommand(), ["build"]);
  const port = /** @type {number} */ (await getAvailablePort(HOST));

  const previewServer = spawn(vpCommand(), ["preview", "--host", HOST, "--port", String(port)], {
    cwd: ROOT,
    stdio: "inherit",
  });

  const shutdown = () => {
    if (!previewServer.killed) {
      previewServer.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await waitForPort(HOST, port, 30_000);

    for (const visualMode of ["default", "flat"]) {
      await runCommand(electronBinary, [path.resolve(ROOT, "electron/capture.cjs")], {
        ELECTRON_START_URL: `http://${HOST}:${port}/?capture=1&visual=${visualMode}`,
        ELECTRON_CAPTURE_OUTPUT_PNG: path.join(OUTPUT_DIR, `${visualMode}-electron-window.png`),
        ELECTRON_CAPTURE_OUTPUT_JSON: path.join(OUTPUT_DIR, `${visualMode}-electron-state.json`),
      });
    }

    console.log(`Electron visual validation capture saved to ${OUTPUT_DIR}`);
  } finally {
    shutdown();
  }
}

await main();
