# PDF Combo

![PDF Combo](brand/preview.png)

A cross-platform desktop app (Windows, macOS, Linux) for combining PDFs: add files,
see every page as a thumbnail, drag pages into the order you want, rotate or drop the
ones you don't, and save the result as a single PDF.

## Running it

```bash
npm install
npm start
```

## Installing on a Mac

```bash
npm run dist:mac
```

Writes `dist/PDF Combo-<version>-universal.dmg` — one universal build that runs
on both Apple Silicon and Intel MacBooks. Open it and drag **PDF Combo** to
Applications.

There is no Apple Developer ID for this project, so the app is ad-hoc signed and
not notarized. macOS will refuse to open it the first time. Right-click the app
and choose **Open** (the dialog then offers to open it anyway), or clear the
quarantine flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/PDF Combo.app"
```

Both are one-time; it launches normally afterwards.

## What it does

- **Add PDFs** with the toolbar button, `Ctrl/Cmd+O`, or by dropping files anywhere in the window.
- **Page-level preview** — every page of every document is rendered as a thumbnail, lazily,
  a few at a time, so large documents stay responsive. Click a page for a large preview.
- **Reorder by dragging** — drag a page (or a whole multi-selection) to any position.
  The insertion point is shown as an accent-coloured line.
- **Select** with click, `Shift`-click for a range, `Ctrl/Cmd`-click to toggle, `Ctrl/Cmd+A` for all.
  Clicking a document in the left panel selects all of its pages.
- **Rotate** selected pages in 90° steps; rotation is baked into the output.
- **Delete pages without losing them** — a deleted page stays in the grid, greyed out and
  stamped, so you can still see it exists. It takes no page number and is left out of the
  saved file. The same button restores it, and *Edit → Restore All Deleted Pages* brings
  everything back. Dropping a whole document from the left panel is the one destructive
  removal.
- **Resize the panels** by dragging either divider. Double-click a divider to reset it, or
  focus it and use `←`/`→` (hold `Shift` for bigger steps). Widths are remembered between runs.
- **Save** the combined PDF with `Ctrl/Cmd+S`; the status bar links to the file when it's written.
- **About** opens from the logo in the top-left corner, or *Help → About PDF Combo*.

### Keyboard

| Key | Action |
| --- | --- |
| `Ctrl/Cmd+O` | Add PDFs |
| `Ctrl/Cmd+S` | Save combined PDF |
| `Ctrl/Cmd+A` | Select all pages |
| `←` / `→` | Move the preview to the previous/next page |
| `Alt+←` / `Alt+→` | Move the selected pages one position |
| `Ctrl/Cmd+[` / `Ctrl/Cmd+]` | Rotate selection left/right |
| `Delete` | Delete the selection — or restore it, if it is already deleted |
| `Esc` | Clear the selection |

## Design

`brand/DESIGN.md` is the source of truth: the two-sheet mark, the Tailwind orange
ramp on zinc neutrals, Inter, Lucide at stroke-width 2, and a theme class on `<html>`
set before first paint. In the app that lands as:

- `src/renderer/tokens.css` — the `--color-combo-*` ramp and surfaces from
  `brand/tokens.css`, restated as plain custom properties (there is no Tailwind here
  to read an `@theme` block) plus the light/dark semantic aliases everything else uses.
- `src/renderer/theme.js` — resolves `localStorage.theme`, falling back to the OS, and
  stamps `.light`/`.dark` on `<html>`. The toolbar's sun/moon button toggles it.
- The mark is inlined twice in `index.html` — the badge for dark surfaces, the flat
  glyph for light — and swapped in CSS, so the right one is present on first paint.
- `build/icon.png` is `brand/icon-512.png`; electron-builder derives the `.ico` and
  `.icns` from it.
- `about.html` is a second window on the same `app://` origin, so it shares the tokens,
  the font and the theme — including live, via a `storage` listener, when the toggle is
  used while it is open.

Two deliberate departures from the guide, both forced by this being a desktop app
rather than a website:

| Guide | Here | Why |
| --- | --- | --- |
| Inter from Google Fonts | Inter bundled from `@fontsource-variable/inter`, vendored next to pdf.js | The app must render its own chrome offline, and it keeps font/style hosts out of the renderer's CSP |
| Inline `<script>` in `<head>` for the theme | External `theme.js`, non-module and non-deferred | The CSP is `script-src 'self'`, which blocks inline scripts; a classic external script is equally render-blocking |

Per-document colour coding is the one place with hues beyond the accent. Those are
data rather than decoration — they have to stay tellable apart — so the brand orange
leads and the rest are Tailwind 500s at a matching weight.

## How it's built

| Piece | Role |
| --- | --- |
| Electron | Windows/macOS/Linux shell, native file dialogs, app menu |
| pdf.js (`pdfjs-dist`) | Renders page thumbnails and the large preview |
| pdf-lib | Copies and rotates pages into the merged output |

- `src/main/main.js` — window, menu, file dialogs, disk I/O.
- `src/main/preload.js` — the only bridge to the renderer (`contextIsolation` on,
  `nodeIntegration` off). Dropped-file paths are resolved here with `webUtils`.
- `src/renderer/` — the whole UI. No framework, no bundler.
- `scripts/vendor.js` — copies the pdf.js and pdf-lib browser builds, Inter, and the
  Lucide icons actually used out of `node_modules` into `src/renderer/vendor/`, so the
  renderer can import them with plain relative paths.
  Runs automatically on `npm install`, `npm start` and `npm run dist`.

The renderer is served from a custom `app://` scheme rather than `file://`, because
Chromium refuses to load ES modules from `file://` origins.

PDF bytes are read in the main process, handed to the renderer once, and kept there:
pdf.js gets a copy to rasterise (it takes ownership of buffers it is given), pdf-lib
merges from the pristine original, and only the finished bytes travel back to be written.

## Tests

```bash
npm run smoke
```

Generates sample PDFs, launches the real app, and drives it through
add → preview → reorder → rotate → delete → restore → resize → merge, then validates the
merged bytes (page count, order, rotations, page boxes, and that deleted pages really are
absent) with pdf-lib in Node, and confirms the brand integration: accent token,
wordmark, painted Lucide icons, loaded Inter, and both themes with the right logo
variant, and the About window down to its dedication line and link target. 44 checks.

The run gets a throwaway Electron profile, wiped before and after, so it neither
inherits nor leaves persisted UI state — testing must not edit the panel widths and
theme of the app you actually use.

It also covers one race worth keeping honest: three rotations fired back-to-back leave two
thumbnail renders superseded mid-flight, and the surviving one must still paint.

## Packaging

```bash
npm run dist        # for the current platform
npm run dist:win    # nsis installer + portable exe
npm run dist:mac    # universal dmg, ad-hoc signed (see scripts/dist-mac.js)
npm run dist:linux  # AppImage + deb
```

Output lands in `dist/`. Each target must be built on (or cross-built for) its own
platform — macOS builds in particular require macOS, and the Windows installer needs
a Windows machine (or Wine). `RELEASING.md` has the two-box release flow.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md) — free to use, modify and share for
personal, hobby, academic, charitable and government use. **Commercial use needs a
separate license**; open an issue.

Credit is not optional: the `Required Notice:` line at the top of `LICENSE.md` has to
travel with the software, including in anything you build on top of it.

This is source-available rather than open source, and that is deliberate — GitHub will
label it accordingly. The third-party components PDF Combo ships with (Electron, pdf.js,
pdf-lib, the bundled fonts and icons) keep their own, more permissive licenses; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Known limits

- Password-protected PDFs are listed with a "Password protected" note and contribute no
  pages; there is no password prompt yet.
- Bookmarks, form fields, annotations and attachments are not carried into the merged
  file — `pdf-lib`'s `copyPages` copies page content, not the document-level structures.
