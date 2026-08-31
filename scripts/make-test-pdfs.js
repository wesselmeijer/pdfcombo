// Generates a few small multi-page PDFs for manual and smoke testing.
// Usage: node scripts/make-test-pdfs.js [outputDir]
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

const outDir = process.argv[2] || path.join(__dirname, '..', 'testdata');

const SPECS = [
  { name: 'alpha.pdf', label: 'Alpha', pages: 3, color: rgb(0.25, 0.4, 0.9) },
  { name: 'beta.pdf', label: 'Beta', pages: 4, color: rgb(0.9, 0.45, 0.2) },
  { name: 'gamma-landscape.pdf', label: 'Gamma', pages: 2, color: rgb(0.15, 0.6, 0.45), landscape: true },
];

async function build(spec) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = spec.landscape ? [842, 595] : [595, 842];

  for (let i = 1; i <= spec.pages; i++) {
    const page = doc.addPage(size);
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: spec.color });
    page.drawText(spec.label, {
      x: 44, y: height - 66, size: 34, font, color: rgb(1, 1, 1),
    });
    page.drawText(`page ${i} of ${spec.pages}`, {
      x: 44, y: height / 2, size: 46, font, color: rgb(0.15, 0.15, 0.2),
    });
    if (i === 2 && spec.label === 'Beta') page.setRotation(degrees(90));
  }
  return doc.save();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (const spec of SPECS) {
    const bytes = await build(spec);
    const target = path.join(outDir, spec.name);
    fs.writeFileSync(target, bytes);
    console.log(`wrote ${target} (${spec.pages} pages, ${bytes.length} bytes)`);
  }
})();
