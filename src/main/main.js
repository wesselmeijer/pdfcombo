'use strict';

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell, Menu } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const isMac = process.platform === 'darwin';
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

// The smoke run drives the real UI, which persists panel widths and the theme to
// localStorage. Point it at a throwaway profile so testing never edits the
// settings of the app the user actually uses — and so each run starts clean.
if (process.env.PDFCOMBO_SMOKE) {
  app.setPath('userData', process.env.PDFCOMBO_SMOKE_PROFILE
    || path.join(app.getPath('temp'), 'pdfcombo-smoke-profile'));
}

let mainWindow = null;

// Chromium refuses to load ES modules over file://, so the renderer is served
// from a real, secure origin instead: app://bundle/…
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
};

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = path.normalize(path.join(RENDERER_ROOT, rel));

    if (!filePath.startsWith(RENDERER_ROOT)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const body = await fs.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    // Painted before the renderer's first frame; the brand surfaces, picked by
    // the OS preference so there is no flash of the wrong one.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafafa',
    show: false,
    title: 'PDF Combo',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const smoke = Boolean(process.env.PDFCOMBO_SMOKE);
  mainWindow.loadURL(`app://bundle/index.html${smoke ? '?smoke=1' : ''}`);

  mainWindow.once('ready-to-show', () => {
    if (smoke) {
      // Drives the renderer through a full add/reorder/merge pass, then exits.
      mainWindow.webContents.on('console-message', (_e, _lvl, msg) => console.log(`[renderer] ${msg}`));
      if (process.env.PDFCOMBO_SMOKE_SHOT) mainWindow.show(); // capturePage needs a visible window
      require('../../scripts/smoke.js')(mainWindow);
      return;
    }
    mainWindow.show();
  });

  // Anything that wants to leave the app opens in the real browser, not a window we own.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let aboutWindow = null;

function openAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    width: 400,
    height: 430,
    parent: mainWindow || undefined,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafafa',
    show: false,
    title: 'About PDF Combo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.loadURL('app://bundle/about.html');
  aboutWindow.once('ready-to-show', () => aboutWindow.show());
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  // wesselmeijer.nl belongs in the user's browser, not in a window we own.
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Belt and braces: a plain click on the link must not navigate this window.
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('app://')) return;
    event.preventDefault();
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
  });
}

function buildMenu() {
  const send = (channel) => () => mainWindow && mainWindow.webContents.send(channel);

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { label: 'About PDF Combo', click: openAboutWindow },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
      : []),
    {
      label: '&File',
      submenu: [
        { label: 'Add PDFs…', accelerator: 'CmdOrCtrl+O', click: send('menu:add') },
        { label: 'Save Combined PDF…', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { type: 'separator' },
        { label: 'Clear All', click: send('menu:clear') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Select All Pages', accelerator: 'CmdOrCtrl+A', click: send('menu:selectAll') },
        { label: 'Delete / Restore Selected Pages', accelerator: 'Delete', click: send('menu:delete') },
        { label: 'Restore All Deleted Pages', click: send('menu:restoreAll') },
        { type: 'separator' },
        { label: 'Rotate Left', accelerator: 'CmdOrCtrl+[', click: send('menu:rotateLeft') },
        { label: 'Rotate Right', accelerator: 'CmdOrCtrl+]', click: send('menu:rotateRight') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'About PDF Combo', click: openAboutWindow },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readPdf(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    throw new Error(`Not a PDF: ${path.basename(filePath)}`);
  }
  const bytes = await fs.readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: bytes.byteLength,
    bytes: new Uint8Array(bytes), // survives the structured clone to the renderer
  };
}

ipcMain.handle('dialog:openPdfs', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Add PDFs',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (canceled) return [];
  return Promise.all(filePaths.map(readPdf));
});

// For drag-and-dropped files, whose paths are resolved in the preload via webUtils.
ipcMain.handle('file:readPdf', (_event, filePath) => readPdf(filePath));

// Takes the merged bytes produced by pdf-lib in the renderer and writes them out.
ipcMain.handle('dialog:savePdf', async (_event, { bytes, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Combined PDF',
    defaultPath: suggestedName || 'combined.pdf',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { saved: false };

  await fs.writeFile(filePath, Buffer.from(bytes));
  return { saved: true, path: filePath };
});

ipcMain.handle('window:openAbout', () => openAboutWindow());

ipcMain.handle('window:closeAbout', () => {
  if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.close();
});

ipcMain.handle('app:info', () => ({
  name: 'PDF Combo',
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
}));

ipcMain.handle('shell:showItem', (_event, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('shell:openPath', (_event, filePath) => shell.openPath(filePath));

app.whenReady().then(() => {
  registerAppProtocol();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
