Packaging icons. electron-builder picks these up automatically.

- `icon.png` — 1024x1024, a copy of `brand/icon-1024.png`. Used for Linux, and
  the source electron-builder derives the macOS `.icns` and Windows `.ico` from.

Do not hand-edit it. Regenerate the mark instead and copy it across:

```sh
node brand/gen-icons.mjs brand/ && cp brand/icon-1024.png build/icon.png
```

See `brand/DESIGN.md` for the geometry.
