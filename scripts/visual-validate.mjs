import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const OUTPUT_DIR = path.resolve(ROOT, "output/playwright");
const HEADED = process.argv.includes("--headed");

function vpCommand() {
  return process.platform === "win32" ? "vp.cmd" : "vp";
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
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

  let browser;
  const shutdown = async () => {
    if (browser) {
      await browser.close();
      browser = undefined;
    }
    if (!previewServer.killed) {
      previewServer.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  try {
    await waitForPort(HOST, port, 30_000);

    browser = await chromium.launch({
      headless: !HEADED,
      channel: "chrome",
      args: ["--enable-unsafe-webgpu", "--disable-dawn-features=disallow_unsafe_apis"],
    });

    for (const visualMode of ["default", "flat"]) {
      const page = await browser.newPage({
        viewport: { width: 1360, height: 920 },
        colorScheme: "dark",
      });
      const consoleMessages = [];
      const pageErrors = [];

      page.on("console", (message) => {
        consoleMessages.push({
          type: message.type(),
          text: message.text(),
        });
      });
      page.on("pageerror", (error) => {
        pageErrors.push({
          name: error.name,
          message: error.message,
        });
      });

      const captureUrl = `http://${HOST}:${port}/?capture=1&visual=${visualMode}`;
      await page.goto(captureUrl, { waitUntil: "networkidle" });
      await page.locator('#renderCanvas[data-ready="1"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        window.advanceTime?.(750);
      });
      await page.waitForTimeout(100);

      const snapshot = await page.evaluate(() => {
        const renderText = window.render_game_to_text?.() ?? "{}";
        const runtime = window.__wrelaRuntime ?? {};
        const metrics = window.__wrelaMetrics ?? {};
        const debugStats = window.__wrelaDebug?.getSceneStats?.() ?? {};
        return {
          renderText,
          runtime,
          metrics,
          debugStats,
        };
      });
      snapshot.consoleMessages = consoleMessages;
      snapshot.pageErrors = pageErrors;
      await page.locator("#renderCanvas").screenshot({
        path: path.join(OUTPUT_DIR, `${visualMode}-frame.png`),
      });
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${visualMode}-page.png`),
        fullPage: true,
      });
      await writeFile(
        path.join(OUTPUT_DIR, `${visualMode}-state.json`),
        JSON.stringify(snapshot, null, 2),
        "utf8",
      );
      await page.close();
    }

    console.log(`Visual validation capture saved to ${OUTPUT_DIR}`);
  } finally {
    await shutdown();
  }
}

await main();
