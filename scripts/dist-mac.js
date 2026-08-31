/**
 * Build the macOS DMG.
 *
 * There is no Apple Developer ID for this project, so the app is ad-hoc signed
 * (`codesign -s -`): no certificate, no team, nothing from the keychain. That
 * matters on Apple Silicon, where an unsigned bundle will not launch at all —
 * and `identity: null` in package.json is what stops electron-builder from
 * quietly picking up an unrelated certificate that happens to be installed.
 *
 * electron-builder only signs as part of packaging, and it skips signing
 * entirely when the identity is null, so the work is split in three: pack the
 * universal .app, sign it here, then wrap the signed bundle in a DMG.
 *
 * The result is not notarized. Gatekeeper will refuse it on first open until
 * the user right-clicks -> Open, or strips the quarantine flag:
 *
 *     xattr -dr com.apple.quarantine "/Applications/PDF Combo.app"
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { build, productName } = JSON.parse(readFileSync('package.json', 'utf8'));
const app = `${build.directories.output}/mac-universal/${productName}.app`;

const builder = (...args) =>
  execFileSync('npx', ['electron-builder', ...args], { stdio: 'inherit' });

builder('--mac', 'dir', '--universal');

// --deep is deprecated for distribution signing but is the documented way to
// ad-hoc sign every nested helper and framework in one go.
execFileSync(
  'codesign',
  ['--force', '--deep', '--sign', '-', '--identifier', build.appId, app],
  { stdio: 'inherit' },
);
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });

builder('--mac', 'dmg', '--universal', '--prepackaged', app);
