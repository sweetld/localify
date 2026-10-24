// Bridge between the Electron main process and the page. The page stays a
// plain web app; it only checks for window.localifyDesktop to receive files
// opened from the OS (file manager "Open with", double-click, command line).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localifyDesktop", {
  // cb receives [{ path, name, type, data: Uint8Array }]. Files opened before
  // the page was ready are delivered as soon as a listener registers.
  onOpenFiles(cb) {
    ipcRenderer.on("open-files", (_e, files) => cb(files));
    ipcRenderer.invoke("take-pending-files").then((files) => {
      if (files.length) cb(files);
    });
  },
});
