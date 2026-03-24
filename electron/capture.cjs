const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const { app, BrowserWindow, shell } = require("electron");

const DIST_INDEX = path.resolve(__dirname, "../dist/index.html");
const PRELOAD = path.resolve(__dirname, "preload.cjs");
const OUTPUT_PNG = process.env.ELECTRON_CAPTURE_OUTPUT_PNG;
const OUTPUT_JSON = process.env.ELECTRON_CAPTURE_OUTPUT_JSON;
const PRESENTATION_MODE = process.env.ELECTRON_CAPTURE_PRESENTATION_MODE ?? "valley";
const VISUAL_MODE = process.env.ELECTRON_CAPTURE_VISUAL_MODE ?? "default";

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-dawn-features", "disallow_unsafe_apis");

async function ensureOutputDirectories() {
  if (OUTPUT_PNG) {
    await mkdir(path.dirname(OUTPUT_PNG), { recursive: true });
  }

  if (OUTPUT_JSON) {
    await mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 920,
    backgroundColor: "#071118",
    show: true,
    title: "Wrela Redwood Slice Capture",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    void window.loadURL(startUrl);
    return window;
  }

  void window.loadFile(DIST_INDEX);
  return window;
}

async function waitForCanvas(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const timeoutMs = 15000;

      const check = () => {
        const canvas = document.querySelector('#renderCanvas[data-ready="1"]');
        if (canvas) {
          resolve(true);
          return;
        }

        if (performance.now() - startedAt > timeoutMs) {
          reject(new Error("Timed out waiting for #renderCanvas[data-ready='1']"));
          return;
        }

        window.setTimeout(check, 50);
      };

      check();
    });
  `);
}

async function collectSnapshot(window) {
  return window.webContents.executeJavaScript(`
    JSON.stringify({
      renderText: window.render_game_to_text?.() ?? "{}",
      runtime: window.__wrelaRuntime ?? {},
      metrics: window.__wrelaMetrics ?? {},
      debugStats: window.__wrelaDebug?.getSceneStats?.() ?? {}
    }, null, 2)
  `);
}

async function main() {
  await ensureOutputDirectories();
  const window = createWindow();
  await waitForCanvas(window);
  await window.webContents.executeJavaScript(`
    window.__wrelaDebug?.setPresentationMode(${JSON.stringify(PRESENTATION_MODE)});
    window.__wrelaDebug?.setVisualMode(${JSON.stringify(VISUAL_MODE)});
    window.advanceTime?.(750);
    true;
  `);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const snapshot = await collectSnapshot(window);
  const image = await window.webContents.capturePage();

  if (OUTPUT_PNG) {
    await writeFile(OUTPUT_PNG, image.toPNG());
  }

  if (OUTPUT_JSON) {
    await writeFile(OUTPUT_JSON, snapshot, "utf8");
  }
}

void app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
