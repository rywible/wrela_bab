const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");

const DIST_INDEX = path.resolve(__dirname, "../dist/index.html");
const PRELOAD = path.resolve(__dirname, "preload.cjs");

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-dawn-features", "disallow_unsafe_apis");

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#071118",
    show: false,
    title: "Wrela Redwood Slice",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    void window.loadURL(startUrl);
    return;
  }

  void window.loadFile(DIST_INDEX);
}

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
