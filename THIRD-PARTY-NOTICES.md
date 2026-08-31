# Third-party notices

PDF Combo itself is licensed under the PolyForm Noncommercial License 1.0.0
(`LICENSE.md`). The components below are **not** — they ship inside the
installers under their own, more permissive terms, and nothing in PDF Combo's
license restricts your rights to them. Each is used unmodified.

| Component | License | Where it is |
|---|---|---|
| [Electron](https://electronjs.org) (with Chromium and Node.js) | MIT | The app shell. Chromium and Node carry their own notices in `Contents/Resources` / `LICENSES.chromium.html` inside the packaged app. |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Apache-2.0 | `src/renderer/vendor/pdf.mjs`, `pdf.worker.mjs` — page rendering |
| [pdf-lib](https://pdf-lib.js.org) | MIT — Copyright (c) 2019 Andrew Dillon | `src/renderer/vendor/pdf-lib.esm.min.js` — the actual page merging |
| Liberation Fonts | SIL Open Font License 1.1 | `src/renderer/vendor/standard_fonts/`, alongside `LICENSE_LIBERATION` |
| Foxit fonts | See `LICENSE_FOXIT` | `src/renderer/vendor/standard_fonts/`, alongside `LICENSE_FOXIT` |
| [Inter](https://rsms.me/inter/) | SIL Open Font License 1.1 | `src/renderer/vendor/inter-latin-wght-normal.woff2` |
| [Lucide](https://lucide.dev) | ISC | `src/renderer/vendor/icons.js` |

pdf.js is Apache-2.0, which asks that you keep its notices intact when
redistributing. The vendored files retain their headers, and `vendor.js` copies
the font licenses across with the fonts — don't strip either.

The PDF Combo name and the two-sheet mark in `brand/` are not covered by the
software license. See `brand/DESIGN.md`.
