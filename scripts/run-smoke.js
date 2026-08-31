'use strict';

// Launches the app in smoke-test mode and reports the result.
// Electron on Windows does not reliably write to an inherited stdout, so the
// checks are also written to a JSON file that this launcher reads back.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const reportPath = path.join(os.tmpdir(), `pdfcombo-smoke-${process.pid}.json`);
try { fs.unlinkSync(reportPath); } catch {}

// A throwaway Electron profile, wiped first, so the run neither inherits nor
// leaves behind persisted UI state (panel widths, theme) — and never touches the
// profile of the installed app.
const profileDir = path.join(os.tmpdir(), `pdfcombo-smoke-profile-${process.pid}`);
fs.rmSync(profileDir, { recursive: true, force: true });

const child = spawn(electron, ['.', '--disable-gpu', '--no-sandbox'], {
  env: {
    ...process.env,
    PDFCOMBO_SMOKE: '1',
    PDFCOMBO_SMOKE_OUT: reportPath,
    PDFCOMBO_SMOKE_PROFILE: profileDir,
  },
  stdio: 'inherit',
});

const timeout = setTimeout(() => {
  console.error('Smoke test timed out after 60s.');
  child.kill();
  process.exit(1);
}, 60000);

child.on('exit', (code) => {
  clearTimeout(timeout);

  fs.rmSync(profileDir, { recursive: true, force: true });

  let checks = null;
  try {
    checks = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    fs.unlinkSync(reportPath);
  } catch {
    console.error(`No smoke report at ${reportPath} — the app exited with code ${code}.`);
    process.exit(code === 0 ? 1 : code);
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
});
