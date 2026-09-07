/* Gera os ícones PNG do PWA a partir de um SVG (node tests/make-icons.js) */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const svg = (size, maskable) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3A8DFF"/><stop offset="1" stop-color="#0058D6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#g)"/>
  <!-- rastro de passos -->
  <g fill="#fff" opacity="0.95">
    <ellipse cx="190" cy="330" rx="46" ry="70" transform="rotate(-12 190 330)"/>
    <ellipse cx="322" cy="220" rx="46" ry="70" transform="rotate(-12 322 220)"/>
    <circle cx="152" cy="232" r="14"/><circle cx="178" cy="222" r="13"/><circle cx="205" cy="222" r="12"/><circle cx="230" cy="234" r="11"/>
    <circle cx="284" cy="122" r="14"/><circle cx="310" cy="112" r="13"/><circle cx="337" cy="112" r="12"/><circle cx="362" cy="124" r="11"/>
  </g>
  <!-- traço de sinal -->
  <polyline points="70,430 110,430 130,395 150,440 170,410 190,430 250,430 270,395 290,440 310,410 330,430 442,430" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
</svg>`;

(async () => {
  const outDir = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jobs = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]];
  for (const [name, size, maskable] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, maskable)}</body></html>`);
    await page.screenshot({ path: path.join(outDir, name), omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('gerado', name);
  }
  await browser.close();
})();
