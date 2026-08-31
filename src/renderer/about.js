const api = window.pdfcombo;

const info = await api.appInfo();

document.getElementById('version').textContent = info.version;
document.getElementById('year').textContent = String(new Date().getFullYear());
// Chromium's full build number is four groups long and wraps; the major is the
// only part anyone reads off an About box anyway.
document.getElementById('runtime').textContent =
  `Electron ${info.electron} · Chromium ${info.chrome.split('.')[0]}`;

// The link carries a real href so it can be copied, but navigation is handled in
// the main process, which hands it to the OS browser instead of loading it here.
document.getElementById('close').addEventListener('click', () => api.closeAbout());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.closeAbout();
});
