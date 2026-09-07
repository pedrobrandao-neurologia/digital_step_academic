/* Teste de fumaça da interface em Chromium headless (node tests/smoke.js) — requer servidor em http://localhost:8080 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.GaitAnalysis && window.Chart && window.jspdf);
  await page.fill('#height', '172');
  await page.fill('#age', '68');
  await page.selectOption('#sex', 'F');
  await page.fill('#personId', 'DEMO01');
  await page.screenshot({ path: path.join(__dirname, 'shot-home.png'), fullPage: false });
  await page.click('#demoBtn');
  await page.waitForSelector('#resultsSection:not(.hidden)', { timeout: 20000 });
  await page.waitForTimeout(500);
  const tiles = await page.$$eval('#tiles .tile', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
  console.log('tiles:', tiles);
  const nMetrics = await page.$$eval('#metricsList .metric', (els) => els.length);
  const nStrides = await page.$$eval('#strideTableWrap tbody tr', (els) => els.length);
  const reportText = await page.$eval('#reportBox', (e) => e.innerText);
  console.log(`métricas: ${nMetrics}, passadas na tabela: ${nStrides}, relatório: ${reportText.length} caracteres`);
  console.log(reportText.split('\n').slice(0, 6).join('\n'));
  // PDF
  const pdfInfo = await page.evaluate(() => { const doc = window.PassoDigital.buildPDF(); return { pages: doc.internal.getNumberOfPages(), bytes: doc.output('arraybuffer').byteLength, b64: doc.output('datauristring').split(',')[1] }; });
  require('fs').writeFileSync(path.join(__dirname, 'relatorio-demo.pdf'), Buffer.from(pdfInfo.b64, 'base64'));
  console.log('pdf:', { pages: pdfInfo.pages, bytes: pdfInfo.bytes });
  await page.screenshot({ path: path.join(__dirname, 'shot-results.png'), fullPage: true });
  // tema escuro
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'shot-dark.png'), fullPage: false });
  // service worker registrado?
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? r.scope : null; });
  console.log('service worker scope:', sw);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).ok);
  console.log('manifest ok:', manifest);
  // modo bolso
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#positionSeg button[data-value="bolso"]');
  await page.click('#demoBtn');
  await page.waitForTimeout(1500);
  const pocketTiles = await page.$$eval('#tiles .tile', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
  console.log('bolso:', pocketTiles);
  await browser.close();
  if (errors.length) { console.log('ERROS:\n' + errors.join('\n')); process.exit(1); }
  console.log('smoke OK');
})().catch((e) => { console.error(e); process.exit(1); });
