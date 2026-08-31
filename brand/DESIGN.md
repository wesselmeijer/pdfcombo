# PDF Combo — design guide

PDF Combo is a sibling of [Where Wes Went](https://whereweswent.com). Same
construction, same typography, same theming machinery; a different glyph and a
different accent hue. Anything not stated here is answered by the travel repo
(`travel/frontend/src/index.css`, `frontend/public/favicon.svg`,
`frontend/scripts/gen-icons.mjs`) — copy from there rather than inventing.

## The mark

Two sheets, the front one solid, in a rounded accent square.

Where Wes Went uses a compass; PDF Combo uses two stacked sheets. What makes
them read as one family is not the subject but the construction, which is fixed:

| | |
|---|---|
| Badge | Rounded square, corner radius **0.22 x** the badge side (7.04 on 32) |
| Glyph box | 24 x 24, drawn at **0.78** of the badge width, centred |
| Slant | **12 degrees** clockwise about the glyph centre |
| Line art | White, `stroke-linejoin: round`, stroke **2.2** in glyph units (thicker than the 2 used for on-screen line icons, so it survives 16px) |
| Colour | One accent, one white. Never a third |

Geometry, in the 24 x 24 glyph box:

```
back sheet   x 9.5  y 2  w 9.5  h 14  r 1.4   stroke white 2.2, no fill
front sheet  x 5    y 8  w 9.5  h 14  r 1.4   fill white, halo stroke 2.6
```

The halo is the one non-obvious part. The front sheet is stroked in the
*background* colour underneath its own fill (`paint-order="stroke"`), which
punches a gap through the back sheet's outline. Without it the two sheets fuse
into a single blob below about 24px — the same reason the compass badge exists
at all rather than a bare outline glyph.

### Variants

- **`logo.svg`** — badge. The default. Use on dark surfaces, as the app icon,
  and anywhere the mark sits alone.
- **`logo-mono.svg`** — glyph only, in `currentColor`, no badge. For light
  surfaces where the badge would be a heavy orange chip: nav bars, inline in
  copy. Set `--logo-gap` to the surface colour if it is not white.
- **`wordmark.svg`** — badge plus the name in Inter 700. Live text, so it needs
  Inter loaded; export to outlines for anywhere it is not.

Where Wes Went swaps between the two in CSS (`dark:hidden` / `hidden dark:block`)
rather than in JS, so the right one is there on first paint. Do the same.

### Don't

- Restyle the glyph: no gradients, no shadow, no second accent, no outline
  version of the front sheet.
- Change the slant or the corner radius — they are the family resemblance.
- Put the badge on an orange background. Use `logo-mono.svg` on tinted
  surfaces instead.
- Scale the badge below 16px. Below that use `favicon.ico`, which is drawn at
  the pixel grid rather than resampled.

## Colour

Tailwind's orange ramp, exposed as `--color-combo-*`; see `tokens.css`.
Where Wes Went is `--color-travel-*` on the equivalent green ramp, and the two
files are line-for-line the same otherwise.

| Token | Hex | Use |
|---|---|---|
| `combo-600` | `#ea580c` | Badge fill, primary buttons, `theme-color` |
| `combo-700` | `#c2410c` | Wordmark text, link and heading colour on light |
| `combo-400` | `#fb923c` | Links and accents in dark mode |
| `combo-100` / `combo-900` | `#ffedd5` / `#7c2d12` | Chip and tag backgrounds, light / dark |
| zinc 50-900 | | Every neutral. Surfaces, borders, body copy |

Orange rather than the obvious PDF red: red is the error colour in every UI
that has one, and a brand ramp that collides with it costs more than the
association is worth. Green stays with the travel site so the two apps are
never mistaken for each other in a tab strip.

The whole hue is one edit — the ramp in `tokens.css`, `ACCENT` in
`gen-icons.mjs`, the two literals in the SVGs — if that call turns out wrong.

## Type

Inter, from Google Fonts, weights 300-700, `display=swap`, with
`preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com`. Identical to
the travel site's `<head>`; copy those four tags.

Bold (700) for the wordmark and page titles, 600 for section headings, 400 for
body. No second family.

## Iconography

Lucide, at `stroke-width: 2`, in a 24 box, no fill unless the icon is the
brand mark. `lucide-react` is already the choice on the travel side. The mark's
glyph is drawn in the same idiom deliberately, so a nav bar of Lucide icons and
the logo look like one set.

## Theming

`.dark` class on `<html>`, set by an inline script in `<head>` before the body
paints, from `localStorage.theme` falling back to
`prefers-color-scheme`. The script is in the travel repo's `index.html` — copy
it verbatim rather than reimplementing, and let a context take over after
hydration.

Light surface `#fafafa`, dark surface `#18181b`, body copy `#18181b` / `#e4e4e7`.

## Files

| File | What it is |
|---|---|
| `logo.svg` | 32 x 32 badge mark |
| `logo-mono.svg` | 24 x 24 glyph, `currentColor` |
| `wordmark.svg` | Badge + name |
| `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-1024.png` | Generated. Do not hand-edit |
| `site.webmanifest` | PWA manifest, `theme_color` matches `combo-600` |
| `tokens.css` | The accent ramp and surfaces, as Tailwind v4 `@theme` |
| `preview.png` | All three logo variants rendered, for the README |
| `gen-icons.mjs` | Regenerates every raster above |

### Regenerating the rasters

```sh
node brand/gen-icons.mjs public/
```

`icon-1024.png` is the desktop packaging source: copy it to `build/icon.png`
and electron-builder derives the `.icns` and `.ico` from it. 1024 rather than
512 because macOS asks for a 512@2x slice.

No dependencies — it rasterises the glyph with 4x supersampling and writes PNG
and ICO itself. It is the travel repo's generator with the glyph and `ACCENT`
swapped; the geometry constants at the top are the source of truth and must
stay in step with `logo.svg` by hand. Change one, change the other, and
re-render — then look at `icon-192.png` and `favicon-32.png` before committing,
because that is the only check there is.
