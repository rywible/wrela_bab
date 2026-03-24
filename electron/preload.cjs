const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("__wrelaDesktop", {
  platform: process.platform,
  runtime: "electron",
});
