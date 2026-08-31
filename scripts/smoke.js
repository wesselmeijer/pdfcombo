'use strict';

// Headless-ish end-to-end check: drives the real renderer through add → preview →
// reorder → rotate → remove → merge, then validates the merged PDF in Node.
// Run with:  npm run smoke

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { PDFDocument } = require('pdf-lib');

const TEST_FILES = ['alpha.pdf', 'beta.pdf', 'gamma-landscape.pdf'];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

module.exports = async function runSmoke(win) {
  let exitCode = 0;
  try {
    const dir = path.join(__dirname, '..', 'testdata');
    if (!fs.existsSync(path.join(dir, TEST_FILES[0]))) {
      throw new Error('testdata missing — run: node scripts/make-test-pdfs.js');
    }

    const descriptors = TEST_FILES.map((name) => {
      const filePath = path.join(dir, name);
      const bytes = fs.readFileSync(filePath);
      return { name, path: filePath, size: bytes.length, bytes: [...bytes] };
    });

    const report = await win.webContents.executeJavaScript(`(async () => {
      const S = window.__smoke;
      if (!S) throw new Error('smoke hook missing');

      const descriptors = ${JSON.stringify(descriptors)}
        .map((d) => ({ ...d, bytes: new Uint8Array(d.bytes) }));
      await S.addPdfFiles(descriptors);

      const out = {
        sourceCount: S.state.sources.size,
        pageCount: S.state.pages.length,
        sourceErrors: [...S.state.sources.values()].filter((s) => s.error).map((s) => s.name + ': ' + s.error),
      };

      // A thumbnail must actually rasterise, and must not come out blank.
      const canvas = await S.renderPageCanvas(S.state.pages[0], 150);
      const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240) ink++;
      }
      out.thumb = { width: canvas.width, height: canvas.height, inkPixels: ink };

      // Reorder: last page to the front.
      const lastUid = S.state.pages[S.state.pages.length - 1].uid;
      S.movePages([lastUid], 0);
      out.movedToFront = S.state.pages[0].uid === lastUid;
      out.domOrderMatches = [...document.getElementById('grid').children]
        .map((c) => c.dataset.uid)
        .join(',') === S.state.pages.map((p) => p.uid).join(',');

      // Rotate that page, then soft-delete what is now the second page.
      S.rotatePages([S.state.pages[0].uid], 90);
      out.rotationApplied = S.state.pages[0].rotation;

      const victim = S.state.pages[1].uid;
      S.setDeleted([victim], true);
      out.totalAfterDelete = S.state.pages.length;
      out.keptAfterDelete = S.keptPages().length;
      out.cardsStillInGrid = document.getElementById('grid').children.length;
      out.deletedCardsMarked = document.querySelectorAll('.page-card.is-deleted').length;
      out.deletedCardIndexLabel =
        document.querySelector('.page-card.is-deleted .page-index').textContent;

      // Restoring must put it straight back, then delete it again for the merge.
      S.setDeleted([victim], false);
      out.keptAfterRestore = S.keptPages().length;
      out.markedAfterRestore = document.querySelectorAll('.page-card.is-deleted').length;
      S.setDeleted([victim], true);

      // Panel dividers.
      S.setPanelWidth('right', 430);
      out.panelResized = S.currentPanelWidth('right');
      S.setPanelWidth('right', 40); // below the minimum — must be clamped, not honoured
      out.panelClamped = S.currentPanelWidth('right');
      S.setPanelWidth('right', 320);

      // Actually drag the left divider, through the real pointer handlers.
      const divider = document.querySelector('.divider[data-panel="left"]');
      S.setPanelWidth('left', 240); // pin it, so a 60px drag cannot hit the clamp
      const startWidth = S.currentPanelWidth('left');
      const rect = divider.getBoundingClientRect();
      const pointer = (type, x) => divider.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1,
        clientX: x, clientY: rect.top + rect.height / 2,
      }));
      pointer('pointerdown', rect.left + 2);
      out.draggingClassApplied = divider.classList.contains('is-dragging')
        && document.body.classList.contains('is-resizing');
      pointer('pointermove', rect.left + 62);
      out.draggedWidth = S.currentPanelWidth('left');
      pointer('pointerup', rect.left + 62);
      out.draggingClassCleared = !divider.classList.contains('is-dragging')
        && !document.body.classList.contains('is-resizing');
      out.dragDelta = out.draggedWidth - startWidth;
      S.setPanelWidth('left', 240);

      // Fire three rotations back-to-back so two render jobs are superseded while
      // still queued. A superseded job used to clear the live job's token, which
      // left the card stuck on its loading shimmer forever.
      const raceUid = S.state.pages[2].uid;
      S.rotatePages([raceUid], 90);
      S.rotatePages([raceUid], 90);
      S.rotatePages([raceUid], 90);

      const raceThumb = () =>
        document.querySelector('[data-uid="' + raceUid + '"] .page-thumb');
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && raceThumb().classList.contains('is-loading')) {
        await new Promise((r) => setTimeout(r, 100));
      }
      out.racedThumbPainted = !!raceThumb().querySelector('canvas')
        && !raceThumb().classList.contains('is-loading');
      out.racedRotation = S.state.pages.find((p) => p.uid === raceUid).rotation;

      out.order = S.keptPages().map((p) =>
        S.state.sources.get(p.sourceId).name + '#' + (p.index + 1) + '@' + p.rotation);

      // Click a card the way a user would, which drives selection + the large preview.
      document.querySelector('.page-card').click();
      out.previewFocused = S.state.focusUid === S.state.pages[0].uid;

      // --- the page-count pill under pressure --------------------------------
      // It used to wrap to two lines inside its own rounded background once the
      // panel got tight. It must shed words instead, and never grow taller.
      const pill = document.getElementById('page-count');
      const measure = async (leftW, rightW) => {
        S.setPanelWidth('left', leftW);
        S.setPanelWidth('right', rightW);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          head: Math.round(pill.closest('.panel-head').clientWidth),
          height: Math.round(pill.getBoundingClientRect().height),
          text: pill.textContent.trim(),
          count: pill.querySelector('.pill-count').textContent,
        };
      };

      out.pillWide = await measure(240, 320);
      out.pillMid = await measure(420, 560);
      out.pillNarrow = await measure(520, 700);
      S.setPanelWidth('left', 240);
      S.setPanelWidth('right', 320);


      // --- toolbar overflow ---------------------------------------------------
      // Constrain the action row and re-run the real collapse pass, rather than
      // trusting a resize to land: the toolbar must never gain a second row.
      const actions = document.querySelector('.toolbar-actions');
      const toolbar = document.querySelector('.toolbar');
      const panel = document.getElementById('overflow-panel');
      const overflowBtn = document.getElementById('btn-overflow');

      const inPanel = (id) => document.getElementById(id).parentElement === panel;
      const toolbarState = () => ({
        height: Math.round(toolbar.getBoundingClientRect().height),
        // The computed style, not the .hidden property: an author display rule
        // silently outranks the UA [hidden] rule, which is how a visible
        // overflow button once passed a check on the property alone.
        btnDisplay: getComputedStyle(overflowBtn).display,
        btnBox: Math.round(overflowBtn.getBoundingClientRect().width),
        zoom: inPanel('zoom'),
        theme: inPanel('btn-theme'),
        panelCount: panel.children.length,
      });

      const atActionsWidth = async (css) => {
        actions.style.flex = css;
        S.updateToolbarOverflow();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return toolbarState();
      };

      out.toolbarRoomy = await atActionsWidth('1 1 auto');
      out.toolbarTight = await atActionsWidth('0 0 520px');
      out.toolbarTiny = await atActionsWidth('0 0 300px');
      actions.style.flex = '';
      S.updateToolbarOverflow();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.toolbarRestored = toolbarState();

      // The slider must survive the trip into the popover with its value intact.
      out.sliderValueAfterMove = document.getElementById('thumb-size').value;

      // --- branding ---------------------------------------------------------
      const css = (name) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim();

      out.accentToken = css('--color-combo-600');
      out.brandName = document.querySelector('.brand-name').textContent;
      out.paintedIcons = document.querySelectorAll('.btn .icon, .page-tool .icon').length;
      out.emptyIconButtons = [...document.querySelectorAll('.btn[data-icon]')]
        .filter((b) => !b.querySelector('.icon')).length;

      await document.fonts.ready;
      out.interLoaded = document.fonts.check('700 14px "Inter Variable"');

      // Theme toggle: both directions, and the logo variant that goes with each.
      const shown = () => (getComputedStyle(document.querySelector('.brand-badge')).display !== 'none'
        ? 'badge' : 'mono');
      window.__theme.set('dark');
      out.darkClass = document.documentElement.classList.contains('dark');
      out.darkLogo = shown();
      out.darkSurface = css('--bg');
      window.__theme.set('light');
      out.lightClass = document.documentElement.classList.contains('light');
      out.lightLogo = shown();
      out.lightSurface = css('--bg');
      window.__theme.set(${JSON.stringify(process.env.PDFCOMBO_SMOKE_THEME || null)});

      const merged = await S.buildMergedPdf();
      out.merged = [...merged];
      return out;
    })()`);

    check('3 sources loaded', report.sourceCount === 3, `got ${report.sourceCount}`);
    check('no source read errors', report.sourceErrors.length === 0, report.sourceErrors.join('; '));
    check('9 pages added (3+4+2)', report.pageCount === 9, `got ${report.pageCount}`);
    check('thumbnail rasterised', report.thumb.width > 0 && report.thumb.height > 0,
      `${report.thumb.width}x${report.thumb.height}`);
    check('thumbnail is not blank', report.thumb.inkPixels > 500, `${report.thumb.inkPixels} ink px`);
    check('drag-reorder moved page to front', report.movedToFront);
    check('DOM order matches model order', report.domOrderMatches);
    check('rotation recorded', report.rotationApplied === 90, `got ${report.rotationApplied}`);
    check('deleted page stays in the model', report.totalAfterDelete === 9,
      `got ${report.totalAfterDelete}`);
    check('deleted page drops out of the kept set', report.keptAfterDelete === 8,
      `got ${report.keptAfterDelete}`);
    check('deleted page still shown in the grid', report.cardsStillInGrid === 9,
      `got ${report.cardsStillInGrid}`);
    check('deleted page is marked as deleted', report.deletedCardsMarked === 1,
      `got ${report.deletedCardsMarked}`);
    check('deleted page loses its position number', report.deletedCardIndexLabel === '–',
      `got "${report.deletedCardIndexLabel}"`);
    check('undelete restores the page', report.keptAfterRestore === 9 && report.markedAfterRestore === 0,
      `kept ${report.keptAfterRestore}, still marked ${report.markedAfterRestore}`);
    check('panel divider resizes the preview', report.panelResized === 430,
      `got ${report.panelResized}`);
    check('panel width is clamped to its minimum', report.panelClamped === 200,
      `got ${report.panelClamped}`);
    check('dragging the divider widens the panel', report.dragDelta === 60,
      `moved 60px, panel changed by ${report.dragDelta}`);
    check('drag state is set then cleared',
      report.draggingClassApplied && report.draggingClassCleared,
      `applied ${report.draggingClassApplied}, cleared ${report.draggingClassCleared}`);
    check('superseded thumbnail renders still repaint', report.racedThumbPainted);
    check('stacked rotations land on 270', report.racedRotation === 270, `got ${report.racedRotation}`);
    check('clicking a page focuses the preview', report.previewFocused);

    const expected = [
      'gamma-landscape.pdf#2@90',
      'alpha.pdf#2@270', 'alpha.pdf#3@0',
      'beta.pdf#1@0', 'beta.pdf#2@0', 'beta.pdf#3@0', 'beta.pdf#4@0',
      'gamma-landscape.pdf#1@0',
    ];
    check('final order is correct', report.order.join('|') === expected.join('|'),
      report.order.join(' | '));

    // Now validate the bytes the app would have written to disk.
    const merged = await PDFDocument.load(Uint8Array.from(report.merged));
    check('deleted page is absent from the saved PDF', merged.getPageCount() === 8,
      `got ${merged.getPageCount()}`);

    const first = merged.getPage(0);
    check('rotated page carries 90° in output', first.getRotation().angle === 90,
      `got ${first.getRotation().angle}`);
    check('landscape page keeps its box', Math.round(first.getSize().width) === 842,
      `got ${Math.round(first.getSize().width)}x${Math.round(first.getSize().height)}`);

    // beta.pdf page 2 was authored at 90°; it must survive the copy untouched.
    check('source rotation preserved', merged.getPage(4).getRotation().angle === 90,
      `got ${merged.getPage(4).getRotation().angle}`);

    check('output is a plausible size', report.merged.length > 1000,
      `${report.merged.length} bytes`);

    // --- the page-count pill ------------------------------------------------
    const pills = [report.pillWide, report.pillMid, report.pillNarrow];
    check('page-count pill never wraps to a second line',
      pills.every((p) => p.height === report.pillWide.height),
      pills.map((p) => `${p.head}px->${p.height}px`).join(', '));
    check('page-count pill always keeps the number',
      pills.every((p) => p.count === '8'),
      pills.map((p) => `"${p.text}"`).join(' | '));
    // --- toolbar overflow ---------------------------------------------------
    const bars = [report.toolbarRoomy, report.toolbarTight, report.toolbarTiny];
    check('toolbar never gains a second row',
      bars.every((b) => b.height === report.toolbarRoomy.height),
      bars.map((b) => `${b.height}px`).join(', '));
    check('roomy toolbar keeps everything inline',
      report.toolbarRoomy.panelCount === 0, `${report.toolbarRoomy.panelCount} in panel`);
    check('overflow button is really not rendered when nothing overflowed',
      report.toolbarRoomy.btnDisplay === 'none' && report.toolbarRoomy.btnBox === 0,
      `display ${report.toolbarRoomy.btnDisplay}, ${report.toolbarRoomy.btnBox}px wide`);
    check('a tight toolbar moves the size slider into the overflow menu',
      report.toolbarTight.zoom && report.toolbarTight.btnDisplay !== 'none'
        && report.toolbarTight.btnBox > 0,
      `zoom in panel ${report.toolbarTight.zoom}, button ${report.toolbarTight.btnBox}px wide`);
    check('a tighter toolbar moves the theme toggle in too',
      report.toolbarTiny.zoom && report.toolbarTiny.theme,
      `${report.toolbarTiny.panelCount} controls in the panel`);
    check('widening puts every control back and hides the button again',
      report.toolbarRestored.panelCount === 0 && report.toolbarRestored.btnDisplay === 'none',
      `${report.toolbarRestored.panelCount} left in panel, display ${report.toolbarRestored.btnDisplay}`);
    check('the slider keeps its value across the move',
      report.sliderValueAfterMove === '170', report.sliderValueAfterMove);

    // --- branding -----------------------------------------------------------
    check('brand accent token is combo-600', report.accentToken === '#ea580c',
      `got ${report.accentToken}`);
    check('wordmark reads "PDF Combo"', report.brandName === 'PDF Combo',
      `got "${report.brandName}"`);
    check('Lucide icons painted into controls', report.paintedIcons >= 12,
      `${report.paintedIcons} icons`);
    check('no control left without its icon', report.emptyIconButtons === 0,
      `${report.emptyIconButtons} empty`);
    check('Inter is loaded', report.interLoaded);
    check('dark theme applies the dark surface',
      report.darkClass && report.darkSurface === '#18181b',
      `class ${report.darkClass}, surface ${report.darkSurface}`);
    check('light theme applies the light surface',
      report.lightClass && report.lightSurface === '#fafafa',
      `class ${report.lightClass}, surface ${report.lightSurface}`);
    check('logo variant follows the surface',
      report.darkLogo === 'badge' && report.lightLogo === 'mono',
      `dark ${report.darkLogo}, light ${report.lightLogo}`);

    if (process.env.PDFCOMBO_SMOKE_SHOT && process.env.PDFCOMBO_SMOKE_OVERFLOW) {
      await win.webContents.executeJavaScript(`(() => {
        document.querySelector('.toolbar-actions').style.flex = '0 0 520px';
        window.__smoke.updateToolbarOverflow();
        document.getElementById('btn-overflow').click();
      })()`);
    }

    if (process.env.PDFCOMBO_SMOKE_SHOT) {
      await new Promise((r) => setTimeout(r, 2500)); // let thumbnails finish
      const image = await win.webContents.capturePage();
      fs.writeFileSync(process.env.PDFCOMBO_SMOKE_SHOT, image.toPNG());
      console.log(`screenshot: ${process.env.PDFCOMBO_SMOKE_SHOT}`);
    }

    // --- about window -------------------------------------------------------
    // Opened last, so it never lands in the screenshot above.
    await win.webContents.executeJavaScript("document.getElementById('btn-about').click()");

    let about = null;
    const aboutDeadline = Date.now() + 5000;
    while (Date.now() < aboutDeadline && !about) {
      about = BrowserWindow.getAllWindows().find((w) => w.id !== win.id) || null;
      if (!about) await wait(100);
    }

    check('clicking the logo opens the About window', !!about);

    if (about) {
      while (about.webContents.isLoading()) await wait(100);

      if (process.env.PDFCOMBO_SMOKE_ABOUT_SHOT) {
        await wait(1200);
        fs.writeFileSync(process.env.PDFCOMBO_SMOKE_ABOUT_SHOT,
          (await about.webContents.capturePage()).toPNG());
        console.log('about screenshot: ' + process.env.PDFCOMBO_SMOKE_ABOUT_SHOT);
      }

      const aboutInfo = await about.webContents.executeJavaScript(`({
        title: document.title,
        name: document.querySelector('.about-name').textContent,
        dedication: document.querySelector('.about-dedication').textContent,
        copyright: document.querySelector('.about-copyright').textContent.replace(/\\s+/g, ' ').trim(),
        linkText: document.getElementById('site').textContent,
        linkHref: document.getElementById('site').href,
        linkTarget: document.getElementById('site').target,
        version: document.getElementById('version').textContent,
      })`);

      check('About window is titled', aboutInfo.title === 'About PDF Combo', aboutInfo.title);
      check('About names the app', aboutInfo.name === 'PDF Combo', aboutInfo.name);
      check('About carries the dedication', aboutInfo.dedication === 'For Liza.',
        `got "${aboutInfo.dedication}"`);
      check('About credits Wessel Meijer',
        /©\s*\d{4}\s*Wessel Meijer/.test(aboutInfo.copyright), aboutInfo.copyright);
      check('About links wesselmeijer.nl',
        aboutInfo.linkText === 'wesselmeijer.nl'
          && aboutInfo.linkHref.startsWith('https://wesselmeijer.nl')
          && aboutInfo.linkTarget === '_blank',
        `${aboutInfo.linkText} -> ${aboutInfo.linkHref} (${aboutInfo.linkTarget})`);
      check('About shows the app version', aboutInfo.version === app.getVersion(),
        `${aboutInfo.version} vs ${app.getVersion()}`);

      // A second click must focus the existing window, not open another.
      await win.webContents.executeJavaScript("document.getElementById('btn-about').click()");
      await wait(400);
      check('About window is a singleton', BrowserWindow.getAllWindows().length === 2,
        `${BrowserWindow.getAllWindows().length} windows open`);

      about.close();
      await wait(300);
      check('About window closes', BrowserWindow.getAllWindows().length === 1,
        `${BrowserWindow.getAllWindows().length} windows open`);
    }
  } catch (err) {
    check('smoke run completed', false, err && err.message ? err.message : String(err));
  }

  exitCode = checks.some((c) => !c.ok) ? 1 : 0;

  if (process.env.PDFCOMBO_SMOKE_OUT) {
    // run-smoke.js prints the report; staying quiet here avoids duplicate output.
    fs.writeFileSync(process.env.PDFCOMBO_SMOKE_OUT, JSON.stringify(checks, null, 2));
  } else {
    for (const c of checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
    }
  }
  app.exit(exitCode);
};
