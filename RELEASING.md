# Releasing

Installers are **not** committed. `dist/` is gitignored and stays that way — a
174 MB DMG in git history is permanent, and GitHub blocks files over 100 MB on
push anyway. Binaries go up as **release assets**, which are attached to a tag
rather than stored as git objects, allow up to 2 GB each, and can be replaced.

The two installers are built on two different machines, so the one thing that
has to be true is that **both are built from the same tag**. Version comes from
`package.json`, and it is what names the files.

## 1. Tag the source (Mac)

Bump `version` in `package.json` if needed, commit, then:

```bash
git tag -a v0.1.0 -m "PDF Combo 0.1.0" && git push origin main --follow-tags
```

## 2. Build the DMG (Mac)

```bash
npm run dist:mac
```

Produces `dist/PDF Combo-0.1.0-universal.dmg` — one universal binary for both
Apple Silicon and Intel. Ad-hoc signed, not notarized; see the README for what
that means for whoever opens it.

## 3. Build the EXE (Windows box)

Check out the *same tag*, don't build from a dirty working tree:

```bash
git fetch --tags && git checkout v0.1.0
npm install
npm run dist:win
```

Produces two files in `dist\`:

| File | What it is |
|---|---|
| `PDF Combo Setup 0.1.0.exe` | NSIS installer. The one most people want — it can pick an install directory and registers an uninstaller. |
| `PDF Combo 0.1.0.exe` | Portable. Single file, runs without installing. |

Both are unsigned, so SmartScreen shows "Windows protected your PC" on first
run: **More info -> Run anyway**. Signing that away needs a paid code-signing
certificate.

Copy both back to the Mac, or upload them from the Windows box directly — the
release just needs all the assets to land on the same tag, in any order.

## 4. Publish the release

With the [`gh` CLI](https://cli.github.com) (`brew install gh`, then `gh auth login`):

```bash
gh release create v0.1.0 --title "PDF Combo 0.1.0" --notes-file NOTES.md "dist/PDF Combo-0.1.0-universal.dmg" "dist/PDF Combo Setup 0.1.0.exe" "dist/PDF Combo 0.1.0.exe"
```

To add the Windows files later, to an existing release:

```bash
gh release upload v0.1.0 "dist/PDF Combo Setup 0.1.0.exe" "dist/PDF Combo 0.1.0.exe"
```

Without `gh`: **Releases -> Draft a new release** on GitHub, pick the existing
tag, and drag the files into the assets box. Keep it a draft until every
artifact is attached, then publish once.

GitHub replaces the spaces in an asset's filename with dots, so
`PDF Combo Setup 0.1.0.exe` is listed and downloaded as
`PDF.Combo.Setup.0.1.0.exe`. Nothing breaks — the download is byte-identical and
the name is cosmetic — but if that bothers you, set `artifactName` under `build`
in `package.json` to something hyphenated and rebuild both installers.

## Release notes

Say which file is which — most people landing on the page do not know whether
they want the installer or the portable build — and repeat the Gatekeeper and
SmartScreen steps. Both apps are unsigned, and a download that appears broken on
first open is the most likely reason someone gives up.
