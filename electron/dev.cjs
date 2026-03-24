const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const electronBinary = require("electron");

const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PORT = 4173;

function vpCommand() {
  return process.platform === "win32" ? "vp.cmd" : "vp";
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
          reject(new Error(`Timed out waiting for dev server on ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };

    tryConnect();
  });
}

async function main() {
  const devServer = spawn(vpCommand(), ["dev", "--host", HOST, "--port", String(PORT)], {
    cwd: ROOT,
    stdio: "inherit",
  });

  let electronProcess;

  const shutdown = () => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill("SIGTERM");
    }
    if (!devServer.killed) {
      devServer.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", shutdown);

  try {
    await waitForPort(HOST, PORT, 30_000);
  } catch (error) {
    shutdown();
    throw error;
  }

  electronProcess = spawn(electronBinary, [path.resolve(__dirname, "main.cjs")], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_START_URL: `http://${HOST}:${PORT}`,
    },
  });

  electronProcess.once("exit", (code) => {
    if (!devServer.killed) {
      devServer.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });

  devServer.once("exit", (code) => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
}

void main();
