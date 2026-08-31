import * as pdfjsLib from './vendor/pdf.mjs';
import { PDFDocument, degrees } from './vendor/pdf-lib.esm.min.js';
import { ICONS } from './vendor/icons.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

const CMAP_URL = new URL('./vendor/cmaps/', import.meta.url).href;
const FONT_URL = new URL('./vendor/standard_fonts/', import.meta.url).href;

/*
 * Per-document colour coding. The brand mark is one accent and white, but these
 * are data, not decoration — they have to stay tellable apart. So: the brand
 * orange leads, and the rest are Tailwind 500s at the same weight, which reads
 * as a deliberate set beside the zinc chrome rather than a stock rainbow.
 */
const SOURCE_COLORS = [
  '#ea580c', // combo-600, the brand accent
  '#0ea5e9', // sky-500
  '#10b981', // emerald-500
  '#a855f7', // purple-500
  '#eab308', // yellow-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
];

const api = window.pdfcombo;

/* ------------------------------------------------------------------ state */

const state = {
  /** id -> { id, name, path, size, bytes, doc, pageCount, color, error } */
  sources: new Map(),
  /** ordered list of { uid, sourceId, index, rotation } */
  pages: [],
  selection: new Set(),
  anchorUid: null,
  focusUid: null,
  thumbWidth: 170,
};

let nextSourceId = 1;
let nextPageUid = 1;

/* --------------------------------------------------------------- elements */

const el = {
  add: document.getElementById('btn-add'),
  addEmpty: document.getElementById('btn-add-empty'),
  save: document.getElementById('btn-save'),
  rotateLeft: document.getElementById('btn-rotate-left'),
  rotateRight: document.getElementById('btn-rotate-right'),
  delete: document.getElementById('btn-delete'),
  reverse: document.getElementById('btn-reverse'),
  clear: document.getElementById('btn-clear'),
  thumbSize: document.getElementById('thumb-size'),
  theme: document.getElementById('btn-theme'),
  about: document.getElementById('btn-about'),
  toolbar: document.querySelector('.toolbar'),
  actions: document.querySelector('.toolbar-actions'),
  overflowBtn: document.getElementById('btn-overflow'),
  overflowPanel: document.getElementById('overflow-panel'),
  divider2: document.getElementById('toolbar-divider-2'),
  sourceList: document.getElementById('source-list'),
  sourceCount: document.getElementById('source-count'),
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  pageCount: document.getElementById('page-count'),
  previewStage: document.getElementById('preview-stage'),
  previewMeta: document.getElementById('preview-meta'),
  prevPage: document.getElementById('prev-page'),
  nextPage: document.getElementById('next-page'),
  status: document.getElementById('status'),
  savedFile: document.getElementById('saved-file'),
  dropzone: document.getElementById('dropzone'),
  busy: document.getElementById('busy'),
  busyText: document.getElementById('busy-text'),
};

/* ------------------------------------------------------------------ icons */

/** Builds a Lucide icon element. Names come from the vendored ICONS map. */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/** Fills every [data-icon] in the markup, so the HTML stays free of path data. */
function paintStaticIcons(scope = document) {
  for (const node of scope.querySelectorAll('[data-icon]')) {
    node.prepend(icon(node.dataset.icon));
  }
}

/** Swaps the glyph inside an existing button. */
function setIcon(node, name) {
  node.querySelector('.icon')?.remove();
  node.prepend(icon(name));
}

/* ---------------------------------------------------------------- helpers */

const cardOf = (uid) => el.grid.querySelector(`[data-uid="${uid}"]`);
const pageOf = (uid) => state.pages.find((p) => p.uid === uid);

/** The pages that will actually end up in the saved file. */
const keptPages = () => state.pages.filter((p) => !p.deleted);

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(message, kind = '') {
  el.status.textContent = message;
  el.status.className = `status-text${kind ? ` is-${kind}` : ''}`;
}

function busy(on, text = 'Working…') {
  el.busyText.textContent = text;
  el.busy.hidden = !on;
}

/**
 * A tiny promise pool. Thumbnails are rendered a few at a time so a 300-page
 * document does not stall the UI thread with a burst of render tasks.
 */
function createQueue(concurrency) {
  const pending = [];
  let active = 0;

  const pump = () => {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      active++;
      job().finally(() => {
        active--;
        pump();
      });
    }
  };

  return (job) => {
    pending.push(job);
    pump();
  };
}

const enqueueThumb = createQueue(3);

/* ------------------------------------------------------------ adding PDFs */

async function addPdfFiles(descriptors) {
  if (!descriptors.length) return;
  busy(true, `Reading ${descriptors.length} file${descriptors.length > 1 ? 's' : ''}…`);

  let addedPages = 0;
  const failures = [];

  for (const desc of descriptors) {
    const source = {
      id: `s${nextSourceId++}`,
      name: desc.name,
      path: desc.path,
      size: desc.size,
      bytes: desc.bytes,
      doc: null,
      pageCount: 0,
      color: SOURCE_COLORS[(nextSourceId - 2) % SOURCE_COLORS.length],
      error: null,
    };

    try {
      // pdf.js takes ownership of the buffer it is handed, so give it a copy
      // and keep our pristine bytes for pdf-lib to merge from later.
      source.doc = await pdfjsLib.getDocument({
        data: source.bytes.slice(),
        cMapUrl: CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: FONT_URL,
      }).promise;
      source.pageCount = source.doc.numPages;
    } catch (err) {
      source.error = err && err.name === 'PasswordException'
        ? 'Password protected'
        : 'Could not be read';
      failures.push(`${desc.name} (${source.error.toLowerCase()})`);
    }

    state.sources.set(source.id, source);

    for (let i = 0; i < source.pageCount; i++) {
      state.pages.push({
        uid: `p${nextPageUid++}`, sourceId: source.id, index: i, rotation: 0, deleted: false,
      });
      addedPages++;
    }
  }

  busy(false);
  renderSources();
  renderGrid();

  if (failures.length) {
    setStatus(`Skipped ${failures.length}: ${failures.join(', ')}`, 'error');
  } else {
    setStatus(`Added ${addedPages} page${addedPages === 1 ? '' : 's'}.`, 'ok');
  }
}

async function pickFiles() {
  try {
    const files = await api.openPdfs();
    await addPdfFiles(files);
  } catch (err) {
    setStatus(`Could not open files: ${err.message}`, 'error');
  }
}

function removeSource(sourceId) {
  const source = state.sources.get(sourceId);
  if (!source) return;
  if (source.doc) source.doc.destroy();
  state.sources.delete(sourceId);

  for (const page of state.pages) {
    if (page.sourceId === sourceId) state.selection.delete(page.uid);
  }
  state.pages = state.pages.filter((p) => p.sourceId !== sourceId);
  if (state.focusUid && !state.pages.some((p) => p.uid === state.focusUid)) state.focusUid = null;

  renderSources();
  renderGrid();
  setStatus(`Removed ${source.name}.`);
}

function clearAll() {
  for (const source of state.sources.values()) if (source.doc) source.doc.destroy();
  state.sources.clear();
  state.pages = [];
  state.selection.clear();
  state.anchorUid = null;
  state.focusUid = null;
  renderSources();
  renderGrid();
  setStatus('Cleared.');
}

/* ------------------------------------------------------------ source list */

function renderSources() {
  el.sourceList.textContent = '';
  el.sourceCount.textContent = String(state.sources.size);

  for (const source of state.sources.values()) {
    const kept = state.pages.filter((p) => p.sourceId === source.id && !p.deleted).length;

    const li = document.createElement('li');
    li.className = `source${source.error ? ' is-error' : ''}`;
    li.style.setProperty('--src-color', source.color);
    li.title = source.path || source.name;

    const chip = document.createElement('span');
    chip.className = 'source-chip';

    const body = document.createElement('div');
    body.className = 'source-body';

    const name = document.createElement('div');
    name.className = 'source-name';
    name.textContent = source.name;

    const sub = document.createElement('div');
    sub.className = 'source-sub';
    sub.textContent = source.error
      ? source.error
      : `${kept} of ${source.pageCount} pages · ${formatBytes(source.size)}`;

    body.append(name, sub);

    const remove = document.createElement('button');
    remove.className = 'source-remove';
    remove.append(icon('x'));
    remove.title = 'Remove this document';
    remove.setAttribute('aria-label', `Remove ${source.name}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeSource(source.id);
    });

    li.addEventListener('click', () => selectSourcePages(source.id));
    li.append(chip, body, remove);
    el.sourceList.append(li);
  }
}

function selectSourcePages(sourceId) {
  state.selection.clear();
  let first = null;
  for (const page of state.pages) {
    if (page.sourceId !== sourceId) continue;
    state.selection.add(page.uid);
    if (!first) first = page.uid;
  }
  state.anchorUid = first;
  if (first) {
    setFocus(first);
    cardOf(first)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  syncSelectionUi();
}

/* -------------------------------------------------------------- page grid */

const visibleCards = new Set();

const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const card = entry.target;
    if (entry.isIntersecting) {
      visibleCards.add(card);
      ensureThumb(card);
    } else {
      visibleCards.delete(card);
    }
  }
}, { root: el.grid, rootMargin: '300px 0px' });

function renderGrid() {
  visibleCards.clear();
  thumbObserver.disconnect();
  el.grid.textContent = '';

  const hasPages = state.pages.length > 0;
  el.empty.hidden = hasPages;
  el.grid.hidden = !hasPages;

  el.grid.style.setProperty('--thumb-w', `${state.thumbWidth}px`);

  const fragment = document.createDocumentFragment();
  for (const page of state.pages) fragment.append(buildCard(page));
  el.grid.append(fragment);

  for (const card of el.grid.children) thumbObserver.observe(card);

  renumberCards();
  syncSelectionUi();
  renderPreview();
}

function buildCard(page) {
  const source = state.sources.get(page.sourceId);

  const card = document.createElement('article');
  card.className = 'page-card';
  card.dataset.uid = page.uid;
  card.draggable = true;
  card.style.setProperty('--src-color', source.color);
  card.title = `${source.name} — page ${page.index + 1}`;

  const thumb = document.createElement('div');
  thumb.className = 'page-thumb is-loading';

  const badge = document.createElement('span');
  badge.className = 'deleted-badge';
  badge.textContent = 'Deleted';

  const tools = document.createElement('div');
  tools.className = 'page-tools';

  const rotateLeft = toolButton('rotate-ccw', 'Rotate left', () => rotatePages([page.uid], -90));
  const rotateRight = toolButton('rotate-cw', 'Rotate right', () => rotatePages([page.uid], 90));
  rotateLeft.classList.add('page-rotate');
  rotateRight.classList.add('page-rotate');

  const toggle = toolButton('trash-2', 'Delete page', () => setDeleted([page.uid], !page.deleted), true);
  toggle.classList.add('page-toggle');

  tools.append(rotateLeft, rotateRight, toggle);

  const foot = document.createElement('div');
  foot.className = 'page-foot';

  const idx = document.createElement('span');
  idx.className = 'page-index';

  const origin = document.createElement('span');
  origin.className = 'page-origin';
  origin.textContent = `${source.name} · p${page.index + 1}`;

  foot.append(idx, origin);
  card.append(thumb, badge, tools, foot);
  applyDeletedState(card, page);
  return card;
}

function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function toolButton(iconName, title, onClick, danger = false) {
  const button = document.createElement('button');
  button.className = `page-tool${danger ? ' is-danger' : ''}`;
  button.type = 'button';
  button.append(icon(iconName));
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function applyDeletedState(card, page) {
  card.classList.toggle('is-deleted', page.deleted);

  const toggle = card.querySelector('.page-toggle');
  const label = page.deleted ? 'Restore page' : 'Delete page';
  setIcon(toggle, page.deleted ? 'undo-2' : 'trash-2');
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  toggle.classList.toggle('is-danger', !page.deleted);
}

/**
 * Renumbers cards in place after a reorder or a delete. Deleted pages hold their
 * slot in the grid but are skipped by the numbering, so what you read on the
 * cards is the page number the saved file will actually have.
 */
function renumberCards() {
  let position = 0;
  for (const card of el.grid.children) {
    const page = pageOf(card.dataset.uid);
    if (!page) continue;
    card.querySelector('.page-index').textContent = page.deleted ? '–' : String(++position);
  }

  const kept = keptPages().length;
  const deleted = state.pages.length - kept;

  // Split so the stylesheet can drop the trailing parts on a narrow panel and
  // keep the count. The spaces live inside the spans, and go with them.
  el.pageCount.textContent = '';
  el.pageCount.append(
    span('pill-count', String(kept)),
    span('pill-unit', ` page${kept === 1 ? '' : 's'}`),
    span('pill-extra', deleted ? ` · ${deleted} deleted` : ''),
  );
  el.pageCount.title = `${kept} page${kept === 1 ? '' : 's'}`
    + (deleted ? `, ${deleted} deleted` : '');

  syncToolbar();
}

/* ------------------------------------------------------------- thumbnails */

async function ensureThumb(card) {
  const page = state.pages.find((p) => p.uid === card.dataset.uid);
  if (!page) return;

  const wanted = `${state.thumbWidth}:${page.rotation}`;
  if (card.dataset.rendered === wanted || card.dataset.rendering === wanted) return;
  card.dataset.rendering = wanted;

  enqueueThumb(async () => {
    // A rotate or resize may have superseded this job while it sat in the queue.
    if (!card.isConnected || card.dataset.rendering !== wanted) return;
    try {
      const inner = state.thumbWidth - 18;
      const canvas = await renderPageCanvas(page, inner, inner * 1.414);
      if (!card.isConnected || card.dataset.rendering !== wanted) return;
      const thumb = card.querySelector('.page-thumb');
      thumb.className = 'page-thumb';
      thumb.textContent = '';
      thumb.append(canvas);
      card.dataset.rendered = wanted;
    } catch (err) {
      if (!card.isConnected || card.dataset.rendering !== wanted) return;
      const thumb = card.querySelector('.page-thumb');
      thumb.className = 'page-thumb is-failed';
      thumb.textContent = 'Preview unavailable';
    } finally {
      // Only clear our own token — a newer job may already own the card.
      if (card.dataset.rendering === wanted) delete card.dataset.rendering;
    }
  });
}

/** Renders a page scaled to fit inside boxW × boxH CSS pixels (boxH optional). */
async function renderPageCanvas(item, boxW, boxH = null) {
  const source = state.sources.get(item.sourceId);
  const pdfPage = await source.doc.getPage(item.index + 1);
  const rotation = ((pdfPage.rotate + item.rotation) % 360 + 360) % 360;

  const unit = pdfPage.getViewport({ scale: 1, rotation });
  const fit = boxH
    ? Math.min(boxW / unit.width, boxH / unit.height)
    : boxW / unit.width;

  const dpr = window.devicePixelRatio || 1;
  const viewport = pdfPage.getViewport({ scale: fit * dpr, rotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;

  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

/** Re-renders everything currently on screen — after a rotate or a size change. */
function refreshVisibleThumbs() {
  for (const card of visibleCards) ensureThumb(card);
}

/* -------------------------------------------------------------- selection */

function syncSelectionUi() {
  for (const card of el.grid.children) {
    card.classList.toggle('is-selected', state.selection.has(card.dataset.uid));
    card.classList.toggle('is-focused', card.dataset.uid === state.focusUid);
  }
  syncToolbar();
}

function syncToolbar() {
  const selected = selectedInOrder();
  const hasSelection = selected.length > 0;
  const kept = keptPages().length;
  const deleted = state.pages.length - kept;

  el.save.disabled = kept === 0;
  el.clear.disabled = state.sources.size === 0;
  el.reverse.disabled = state.pages.length < 2;
  el.rotateLeft.disabled = !hasSelection;
  el.rotateRight.disabled = !hasSelection;
  el.delete.disabled = !hasSelection;

  // The one button both deletes and restores, following what is selected.
  const restoring = hasSelection && selected.every((uid) => pageOf(uid).deleted);
  el.delete.querySelector('.btn-label').textContent = restoring ? 'Restore' : 'Delete';
  setIcon(el.delete, restoring ? 'undo-2' : 'trash-2');
  el.delete.title = restoring
    ? 'Restore the selected pages'
    : 'Delete the selected pages (they stay visible, greyed out)';

  const at = state.pages.findIndex((p) => p.uid === state.focusUid);
  el.prevPage.disabled = at <= 0;
  el.nextPage.disabled = at < 0 || at >= state.pages.length - 1;

  const parts = [
    deleted
      ? `${kept} of ${state.pages.length} pages`
      : `${kept} page${kept === 1 ? '' : 's'}`,
  ];
  if (state.sources.size) parts.push(`${state.sources.size} document${state.sources.size === 1 ? '' : 's'}`);
  if (hasSelection) parts.push(`${selected.length} selected`);
  if (!el.status.classList.contains('is-error')) setStatus(parts.join(' · '));
}

function handleCardClick(event, uid) {
  const additive = event.ctrlKey || event.metaKey;

  if (event.shiftKey && state.anchorUid) {
    const from = state.pages.findIndex((p) => p.uid === state.anchorUid);
    const to = state.pages.findIndex((p) => p.uid === uid);
    if (from >= 0 && to >= 0) {
      if (!additive) state.selection.clear();
      const [lo, hi] = from < to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i++) state.selection.add(state.pages[i].uid);
    }
  } else if (additive) {
    if (state.selection.has(uid)) state.selection.delete(uid);
    else state.selection.add(uid);
    state.anchorUid = uid;
  } else {
    state.selection.clear();
    state.selection.add(uid);
    state.anchorUid = uid;
  }

  setFocus(uid);
}

function selectAll() {
  state.selection = new Set(state.pages.map((p) => p.uid));
  syncSelectionUi();
}

/* ------------------------------------------------------------- page edits */

function selectedInOrder() {
  return state.pages.filter((p) => state.selection.has(p.uid)).map((p) => p.uid);
}

function rotatePages(uids, delta) {
  if (!uids.length) return;
  const set = new Set(uids);
  for (const page of state.pages) {
    if (set.has(page.uid)) page.rotation = ((page.rotation + delta) % 360 + 360) % 360;
  }
  for (const uid of uids) {
    const card = cardOf(uid);
    if (card) ensureThumb(card);
  }
  if (set.has(state.focusUid)) renderPreview();
  setStatus(`Rotated ${uids.length} page${uids.length === 1 ? '' : 's'}.`);
}

/**
 * Deleting is non-destructive: the page stays in the grid, struck out, and is
 * simply skipped when the file is written. Passing deleted=false brings it back.
 */
function setDeleted(uids, deleted) {
  if (!uids.length) return;
  let changed = 0;

  for (const uid of uids) {
    const page = pageOf(uid);
    if (!page || page.deleted === deleted) continue;
    page.deleted = deleted;
    changed++;
    const card = cardOf(uid);
    if (card) applyDeletedState(card, page);
  }
  if (!changed) return;

  renumberCards();
  renderSources();
  if (uids.includes(state.focusUid)) renderPreview();

  setStatus(`${deleted ? 'Deleted' : 'Restored'} ${changed} page${changed === 1 ? '' : 's'}.`);
}

/** Delete the selection, or restore it if every selected page is already deleted. */
function toggleDeleteSelection() {
  const uids = selectedInOrder();
  if (!uids.length) return;
  setDeleted(uids, !uids.every((uid) => pageOf(uid).deleted));
}

function restoreAllPages() {
  setDeleted(state.pages.filter((p) => p.deleted).map((p) => p.uid), false);
}

function reverseOrder() {
  state.pages.reverse();
  renderGrid();
  setStatus('Reversed page order.');
}

/** Moves the given pages so they sit at `targetIndex` of the current order. */
function movePages(uids, targetIndex) {
  const set = new Set(uids);
  const moving = state.pages.filter((p) => set.has(p.uid));
  if (!moving.length) return;

  const before = state.pages.slice(0, targetIndex).filter((p) => !set.has(p.uid));
  const after = state.pages.slice(targetIndex).filter((p) => !set.has(p.uid));
  state.pages = [...before, ...moving, ...after];

  reorderCards();
}

/** Reflows existing cards to match state.pages — keeps rendered canvases alive. */
function reorderCards() {
  const byUid = new Map([...el.grid.children].map((card) => [card.dataset.uid, card]));
  const fragment = document.createDocumentFragment();
  for (const page of state.pages) {
    const card = byUid.get(page.uid);
    if (card) fragment.append(card);
  }
  el.grid.append(fragment);
  renumberCards();
  syncSelectionUi();
}

function nudgeSelection(direction) {
  const uids = selectedInOrder();
  if (!uids.length) return;
  const set = new Set(uids);
  const positions = state.pages.reduce((acc, p, i) => (set.has(p.uid) ? [...acc, i] : acc), []);

  if (direction < 0) {
    if (positions[0] === 0) return;
    movePages(uids, positions[0] - 1);
  } else {
    const last = positions[positions.length - 1];
    if (last === state.pages.length - 1) return;
    // +2 accounts for the moved block being spliced out of the array first.
    movePages(uids, last + 2);
  }
}

/* ------------------------------------------------------- drag to reorder */

let dragUids = null;

el.grid.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.page-card');
  if (!card) return;

  if (!state.selection.has(card.dataset.uid)) {
    state.selection.clear();
    state.selection.add(card.dataset.uid);
    state.anchorUid = card.dataset.uid;
    setFocus(card.dataset.uid);
  }

  dragUids = selectedInOrder();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-pdfcombo-pages', dragUids.join(','));
  for (const uid of dragUids) cardOf(uid)?.classList.add('is-dragging');
});

el.grid.addEventListener('dragend', () => {
  clearDropMarkers();
  stopAutoScroll();
  for (const card of el.grid.children) card.classList.remove('is-dragging');
  dragUids = null;
});

el.grid.addEventListener('dragover', (event) => {
  if (!dragUids) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  dragPoint = { x: event.clientX, y: event.clientY };
  paintDropMarker();
  updateAutoScroll();
});

el.grid.addEventListener('dragleave', (event) => {
  // Only stop once the pointer has actually left the grid, not when it crosses
  // from the grid onto one of the cards inside it.
  if (dragUids && !el.grid.contains(event.relatedTarget)) stopAutoScroll();
});

el.grid.addEventListener('drop', (event) => {
  if (!dragUids) return;
  event.preventDefault();
  event.stopPropagation();

  const target = dropTargetFor(event.clientX, event.clientY);
  clearDropMarkers();
  stopAutoScroll();

  let index = target.card
    ? state.pages.findIndex((p) => p.uid === target.card.dataset.uid) + (target.after ? 1 : 0)
    : state.pages.length;

  movePages(dragUids, index);
  setStatus(`Moved ${dragUids.length} page${dragUids.length === 1 ? '' : 's'}.`);
  dragUids = null;
});

/** Finds the card the pointer is nearest to, and which side of it we are on. */
function dropTargetFor(x, y) {
  const cards = [...el.grid.children];
  let best = null;
  let bestDistance = Infinity;

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distance = Math.hypot(x - cx, y - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { card, after: x > cx };
    }
  }
  return best || { card: null, after: false };
}

/** Draws the insertion bar for wherever the drag currently points. */
function paintDropMarker() {
  if (!dragPoint) return;
  const target = dropTargetFor(dragPoint.x, dragPoint.y);
  clearDropMarkers();
  if (target.card) target.card.classList.add(target.after ? 'drop-after' : 'drop-before');
}

function clearDropMarkers() {
  for (const card of el.grid.children) card.classList.remove('drop-before', 'drop-after');
}

/* The grid scrolls itself when a drag lingers near its top or bottom edge, so a
   page can be carried past the visible rows without letting go. The drag events
   only fire while the pointer moves, so the scrolling runs off its own frame
   loop and re-reads the last known pointer position each frame. */

const EDGE_ZONE = 90; // distance from an edge, in px, where scrolling starts
const EDGE_SPEED = 16; // px per frame at the very edge, tapering to 0

let dragPoint = null;
let autoScrollStep = 0;
let autoScrollFrame = 0;

function updateAutoScroll() {
  const rect = el.grid.getBoundingClientRect();
  const fromTop = dragPoint.y - rect.top;
  const fromBottom = rect.bottom - dragPoint.y;

  if (fromTop < EDGE_ZONE) {
    autoScrollStep = -EDGE_SPEED * (1 - Math.max(fromTop, 0) / EDGE_ZONE);
  } else if (fromBottom < EDGE_ZONE) {
    autoScrollStep = EDGE_SPEED * (1 - Math.max(fromBottom, 0) / EDGE_ZONE);
  } else {
    autoScrollStep = 0;
  }

  if (autoScrollStep && !autoScrollFrame) {
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }
}

function runAutoScroll() {
  autoScrollFrame = 0;
  if (!dragUids || !autoScrollStep) return;

  const before = el.grid.scrollTop;
  el.grid.scrollTop += autoScrollStep;
  if (el.grid.scrollTop === before) return; // already at the end of the list

  // The cards moved under a stationary pointer, so the insertion point changed.
  paintDropMarker();
  autoScrollFrame = requestAnimationFrame(runAutoScroll);
}

function stopAutoScroll() {
  if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
  autoScrollFrame = 0;
  autoScrollStep = 0;
  dragPoint = null;
}

/* ------------------------------------------------------------- OS file drop */

let dragDepth = 0;

function isFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  dragDepth++;
  el.dropzone.hidden = false;
});

window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    el.dropzone.hidden = true;
  }
});

window.addEventListener('dragover', (event) => {
  if (isFileDrag(event)) event.preventDefault();
});

window.addEventListener('drop', async (event) => {
  dragDepth = 0;
  el.dropzone.hidden = true;
  if (!isFileDrag(event)) return;
  event.preventDefault();

  const files = [...event.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name));
  if (!files.length) {
    setStatus('Only PDF files can be added.', 'error');
    return;
  }

  const descriptors = [];
  for (const file of files) {
    try {
      descriptors.push(await api.readDroppedFile(file));
    } catch (err) {
      setStatus(`Could not read ${file.name}: ${err.message}`, 'error');
    }
  }
  await addPdfFiles(descriptors);
});

/* ---------------------------------------------------------------- preview */

let previewToken = 0;

function setFocus(uid) {
  state.focusUid = uid;
  syncSelectionUi();
  renderPreview();
}

async function renderPreview() {
  const token = ++previewToken;
  const page = state.pages.find((p) => p.uid === state.focusUid);

  if (!page) {
    el.previewStage.innerHTML = '<p class="preview-placeholder">Select a page to preview it here.</p>';
    el.previewMeta.textContent = '';
    return;
  }

  const source = state.sources.get(page.sourceId);
  const kept = keptPages();
  const position = kept.indexOf(page) + 1;

  el.previewMeta.textContent =
    (page.deleted
      ? 'Deleted — not in the saved file'
      : `Position ${position} of ${kept.length}`) +
    ` · ${source.name} · page ${page.index + 1}` +
    (page.rotation ? ` · rotated ${page.rotation}°` : '');
  el.previewMeta.classList.toggle('is-deleted', page.deleted);

  const width = Math.max(160, el.previewStage.clientWidth - 28);
  const height = Math.max(200, el.previewStage.clientHeight - 28);
  try {
    const canvas = await renderPageCanvas(page, width, height);
    if (token !== previewToken) return;
    el.previewStage.textContent = '';
    el.previewStage.append(canvas);
  } catch {
    if (token !== previewToken) return;
    el.previewStage.innerHTML = '<p class="preview-placeholder">This page could not be rendered.</p>';
  }
}

function stepPreview(delta) {
  const at = state.pages.findIndex((p) => p.uid === state.focusUid);
  const next = state.pages[at + delta];
  if (!next) return;
  state.selection.clear();
  state.selection.add(next.uid);
  state.anchorUid = next.uid;
  setFocus(next.uid);
  cardOf(next.uid)?.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------ merge & save */

async function buildMergedPdf() {
  const out = await PDFDocument.create();
  out.setProducer('PDFCombo');
  out.setCreator('PDFCombo');
  out.setTitle('Combined document');

  const pages = keptPages(); // deleted pages never reach the file
  if (!pages.length) throw new Error('every page is deleted');

  // Copy each source once, taking all of its pages in a single call — copying
  // page by page would re-embed shared resources and bloat the output.
  const bySource = new Map();
  for (const page of pages) {
    if (!bySource.has(page.sourceId)) bySource.set(page.sourceId, []);
    bySource.get(page.sourceId).push(page);
  }

  const copiedFor = new Map();
  for (const [sourceId, items] of bySource) {
    const source = state.sources.get(sourceId);
    const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    const copies = await out.copyPages(doc, items.map((i) => i.index));
    items.forEach((item, k) => copiedFor.set(item.uid, copies[k]));
  }

  for (const page of pages) {
    const copy = copiedFor.get(page.uid);
    const base = copy.getRotation().angle;
    copy.setRotation(degrees(((base + page.rotation) % 360 + 360) % 360));
    out.addPage(copy);
  }

  return out.save();
}

function suggestedName() {
  const first = state.sources.values().next().value;
  const stem = first ? first.name.replace(/\.pdf$/i, '') : 'combined';
  return `${stem}-combined.pdf`;
}

async function saveCombined() {
  const count = keptPages().length;
  if (!count) return;
  busy(true, `Combining ${count} pages…`);
  try {
    const bytes = await buildMergedPdf();
    busy(false);

    const result = await api.savePdf(bytes, suggestedName());
    if (!result.saved) {
      setStatus('Save cancelled.');
      return;
    }
    setStatus(`Saved ${count} page${count === 1 ? '' : 's'} to ${result.path}`, 'ok');
    el.savedFile.textContent = result.path;
    el.savedFile.title = 'Open the saved file';
    el.savedFile.dataset.path = result.path;
  } catch (err) {
    setStatus(`Could not combine: ${err.message}`, 'error');
  } finally {
    busy(false);
  }
}

/* -------------------------------------------------------- toolbar overflow */

/*
 * The toolbar never wraps. When the window is too narrow for every control, the
 * lowest-priority ones move into a popover behind an ellipsis button — the real
 * nodes, not copies, so the slider keeps its value and every listener stays put.
 *
 * Order is the order they leave the bar: the size slider first (it is the widest
 * and the least often reached for), then the theme toggle, then Reverse and
 * Clear if it is still tight, so nothing ever ends up clipped.
 */
const COLLAPSE_ORDER = ['zoom', 'btn-theme', 'btn-reverse', 'btn-clear']
  .map((id) => document.getElementById(id));

/** Every action in its original bar order, captured before anything moves. */
const TOOLBAR_ORDER = [...el.actions.children];

function toolbarOverflows() {
  return el.actions.scrollWidth > el.actions.clientWidth + 1;
}

function updateToolbarOverflow() {
  // Start from everything inline, so widening puts controls back.
  for (const node of TOOLBAR_ORDER) el.actions.append(node);
  el.divider2.hidden = false;

  const moved = new Set();
  for (const node of COLLAPSE_ORDER) {
    if (!toolbarOverflows()) break;
    el.overflowPanel.append(node);
    moved.add(node);
  }

  // Lay the panel out in the bar's order rather than the order they collapsed.
  for (const node of TOOLBAR_ORDER) {
    if (moved.has(node)) el.overflowPanel.append(node);
  }

  // A trailing separator with nothing after it is just noise.
  el.divider2.hidden = moved.has(COLLAPSE_ORDER[0]) && moved.has(COLLAPSE_ORDER[1]);

  el.overflowBtn.hidden = moved.size === 0;
  if (el.overflowBtn.hidden) setOverflowOpen(false);
}

function setOverflowOpen(open) {
  el.overflowPanel.hidden = !open;
  el.overflowBtn.setAttribute('aria-expanded', String(open));
}

const overflowIsOpen = () => !el.overflowPanel.hidden;

el.overflowBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  setOverflowOpen(!overflowIsOpen());
});

document.addEventListener('click', (event) => {
  if (overflowIsOpen() && !event.target.closest('.toolbar-overflow')) setOverflowOpen(false);
});

let toolbarWidth = 0;
new ResizeObserver(() => {
  // Width is the only thing that matters, and ignoring height changes keeps the
  // observer from re-triggering on its own layout effects.
  const width = Math.round(el.toolbar.clientWidth);
  if (width === toolbarWidth) return;
  toolbarWidth = width;
  updateToolbarOverflow();
}).observe(el.toolbar);

/* ----------------------------------------------------------------- theme */

/*
 * theme.js has already resolved and applied the theme before first paint; this
 * only drives the toggle. The button shows the theme you would switch *to*.
 */
function updateThemeButton() {
  const dark = window.__theme.resolved() === 'dark';
  setIcon(el.theme, dark ? 'sun' : 'moon');
  const label = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
  el.theme.title = label;
  el.theme.setAttribute('aria-label', label);
  // Icon-only in the toolbar; the label only shows once it moves into the popover.
  el.theme.querySelector('.btn-label').textContent = dark ? 'Light theme' : 'Dark theme';
}

function toggleTheme() {
  window.__theme.set(window.__theme.resolved() === 'dark' ? 'light' : 'dark');
  updateThemeButton();
  refreshVisibleThumbs(); // the shimmer and page edges are theme-coloured
}

/* ------------------------------------------------------- resizable panels */

const PANELS = {
  left: { cssVar: '--left-w', min: 150, max: 520, initial: 240 },
  right: { cssVar: '--right-w', min: 200, max: 700, initial: 320 },
};

const MIN_GRID_WIDTH = 320; // the page grid always keeps at least this much

function setPanelWidth(which, width) {
  const spec = PANELS[which];
  const other = which === 'left' ? 'right' : 'left';
  const otherWidth = currentPanelWidth(other);
  const available = document.querySelector('.layout').clientWidth - otherWidth - MIN_GRID_WIDTH - 8;

  const clamped = Math.round(Math.min(Math.max(width, spec.min), Math.min(spec.max, available)));
  document.documentElement.style.setProperty(spec.cssVar, `${clamped}px`);
  return clamped;
}

function currentPanelWidth(which) {
  const spec = PANELS[which];
  const raw = getComputedStyle(document.documentElement).getPropertyValue(spec.cssVar);
  return parseFloat(raw) || spec.initial;
}

function savePanelWidths() {
  try {
    localStorage.setItem('pdfcombo.panels', JSON.stringify({
      left: currentPanelWidth('left'),
      right: currentPanelWidth('right'),
    }));
  } catch {
    // Storage being unavailable is not worth failing a resize over.
  }
}

function restorePanelWidths() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('pdfcombo.panels') || 'null');
  } catch {
    saved = null;
  }
  for (const which of ['left', 'right']) {
    const width = saved && Number(saved[which]);
    setPanelWidth(which, width > 0 ? width : PANELS[which].initial);
  }
}

function setupDivider(divider) {
  const which = divider.dataset.panel;

  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = currentPanelWidth(which);

    try {
      divider.setPointerCapture(event.pointerId);
    } catch {
      // No live pointer to capture (synthetic events); the listeners below still work.
    }
    divider.classList.add('is-dragging');
    document.body.classList.add('is-resizing');

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      // Dragging the right divider left makes the preview wider, not narrower.
      setPanelWidth(which, which === 'left' ? startWidth + delta : startWidth - delta);
    };

    const onUp = () => {
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      divider.removeEventListener('pointercancel', onUp);
      divider.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      savePanelWidths();
      renderPreview(); // re-rasterise at the new size
    };

    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
    divider.addEventListener('pointercancel', onUp);
  });

  divider.addEventListener('dblclick', () => {
    setPanelWidth(which, PANELS[which].initial);
    savePanelWidths();
    renderPreview();
  });

  divider.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();

    const delta = event.key === 'ArrowLeft' ? -step : step;
    setPanelWidth(which, currentPanelWidth(which) + (which === 'left' ? delta : -delta));
    savePanelWidths();
    renderPreview();
  });
}

document.querySelectorAll('.divider').forEach(setupDivider);
restorePanelWidths();

/* ----------------------------------------------------------------- events */

el.about.addEventListener('click', () => api.openAbout());
el.theme.addEventListener('click', toggleTheme);
el.add.addEventListener('click', pickFiles);
el.addEmpty.addEventListener('click', pickFiles);
el.save.addEventListener('click', saveCombined);
el.clear.addEventListener('click', clearAll);
el.reverse.addEventListener('click', reverseOrder);
el.delete.addEventListener('click', toggleDeleteSelection);
el.rotateLeft.addEventListener('click', () => rotatePages(selectedInOrder(), -90));
el.rotateRight.addEventListener('click', () => rotatePages(selectedInOrder(), 90));
el.prevPage.addEventListener('click', () => stepPreview(-1));
el.nextPage.addEventListener('click', () => stepPreview(1));

el.savedFile.addEventListener('click', () => {
  if (el.savedFile.dataset.path) api.openPath(el.savedFile.dataset.path);
});

el.grid.addEventListener('click', (event) => {
  const card = event.target.closest('.page-card');
  if (!card) {
    state.selection.clear();
    syncSelectionUi();
    return;
  }
  handleCardClick(event, card.dataset.uid);
});

let sizeTimer = null;
el.thumbSize.addEventListener('input', () => {
  state.thumbWidth = Number(el.thumbSize.value);
  el.grid.style.setProperty('--thumb-w', `${state.thumbWidth}px`);
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(refreshVisibleThumbs, 250);
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  // Re-clamp so a shrinking window never squeezes the page grid out of existence.
  setPanelWidth('left', currentPanelWidth('left'));
  setPanelWidth('right', currentPanelWidth('right'));
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPreview, 200);
});

window.addEventListener('keydown', (event) => {
  const meta = event.ctrlKey || event.metaKey;

  if (event.key === 'Escape') {
    if (overflowIsOpen()) {
      setOverflowOpen(false);
      return;
    }
    state.selection.clear();
    syncSelectionUi();
    return;
  }
  if (meta && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selectAll();
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (state.selection.size) {
      event.preventDefault();
      toggleDeleteSelection();
    }
    return;
  }
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    nudgeSelection(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (!meta && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    if (!state.focusUid) return;
    event.preventDefault();
    stepPreview(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

api.onMenu.add(pickFiles);
api.onMenu.save(saveCombined);
api.onMenu.clear(clearAll);
api.onMenu.selectAll(selectAll);
api.onMenu.delete(toggleDeleteSelection);
api.onMenu.restoreAll(restoreAllPages);
api.onMenu.rotateLeft(() => rotatePages(selectedInOrder(), -90));
api.onMenu.rotateRight(() => rotatePages(selectedInOrder(), 90));

paintStaticIcons();
updateThemeButton();
updateToolbarOverflow();
renderGrid();
setStatus('Add PDFs to get started.');

// Test hook: only present when the window is opened with ?smoke=1 (see scripts/smoke.js).
if (new URLSearchParams(location.search).has('smoke')) {
  window.__smoke = {
    state, addPdfFiles, buildMergedPdf, renderPageCanvas, keptPages,
    movePages, rotatePages, setDeleted, renderGrid,
    setPanelWidth, currentPanelWidth, updateToolbarOverflow,
  };
}
