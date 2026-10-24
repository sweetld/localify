// Localify desktop shell. Wraps the single-page web app (index.html) in a
// Chromium window so it behaves identically on Windows, macOS and Linux —
// same UI, same MP3/OGG codecs, same File System Access API — and adds the
// one thing a browser tab can't do: open audio files handed over by the OS.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const APP_ROOT = path.join(__dirname, "..");
const ORIGIN = "app://localify";
const AUDIO_RE = /\.(mp3|ogg|oga)$/i;
const MIME = { mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg" };

// Serve the app from a custom secure origin rather than file:// so storage
// (IndexedDB / localStorage) gets a stable, proper origin and fetch() to the
// metadata APIs behaves exactly as it does on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null;
let rendererReady = false;   // page has registered its open-files listener
let pendingPaths = [];       // opened before the page was ready to receive them

// ---- files handed over by the OS ------------------------------------------

function pathsFromArgv(argv, cwd) {
  // Packaged: [exe, ...args]. Dev (`electron .`): [electron, ".", ...args].
  // Linux file managers may pass file:// URIs (the desktop entry uses %U).
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.filter((a) => !a.startsWith("-")).map((a) => {
    if (/^file:\/\//i.test(a)) { try { return fileURLToPath(a); } catch { return a; } }
    return path.resolve(cwd || process.cwd(), a);
  });
}

async function collectAudio(p, out) {
  let st;
  try { st = await fs.stat(p); } catch { return; }
  if (st.isDirectory()) {
    let entries = [];
    try { entries = await fs.readdir(p); } catch { return; }
    for (const name of entries.sort()) await collectAudio(path.join(p, name), out);
  } else if (AUDIO_RE.test(p)) {
    out.push(p);
  }
}

async function readAudioFiles(paths) {
  const found = [];
  for (const p of paths) await collectAudio(p, found);
  const files = [];
  for (const p of found) {
    try {
      const data = await fs.readFile(p);
      const ext = path.extname(p).slice(1).toLowerCase();
      files.push({ path: p, name: path.basename(p), type: MIME[ext] || "", data: new Uint8Array(data) });
    } catch { /* unreadable — skip it */ }
  }
  return files;
}

async function openPaths(paths) {
  if (!paths.length) return;
  if (!rendererReady || !win) { pendingPaths.push(...paths); return; }
  const files = await readAudioFiles(paths);
  if (files.length) win.webContents.send("open-files", files);
}

ipcMain.handle("take-pending-files", async () => {
  rendererReady = true;
  const paths = pendingPaths;
  pendingPaths = [];
  return readAudioFiles(paths);
});

// macOS delivers Finder "Open With" / double-clicks as events, possibly before
// the app is ready, so this listener must be registered at startup.
app.on("open-file", (event, p) => {
  event.preventDefault();
  openPaths([p]);
  if (win) focusWindow();
});

app.on("second-instance", (_e, argv, cwd) => {
  focusWindow();
  openPaths(pathsFromArgv(argv, cwd));
});

// ---- window ----------------------------------------------------------------

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#121212",
    title: "Localify",
    icon: path.join(APP_ROOT, "build/icons/512x512.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; rendererReady = false; });
  // A reload drops the page's listener; queue until it registers again.
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) rendererReady = false;
  });

  // Links (e.g. "Get a key at acoustid.org") open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(ORIGIN + "/")) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  win.loadURL(ORIGIN + "/index.html");
}

function buildMenu() {
  if (process.platform !== "darwin") { Menu.setApplicationMenu(null); return; }
  // macOS needs an app menu for Quit / Cmd+C / Cmd+V etc. to work.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ]));
}

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(APP_ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(APP_ROOT + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  buildMenu();
  createWindow();
  openPaths(pathsFromArgv(process.argv));

  app.on("activate", () => { if (!win) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
