const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'index.html'));
  await p.waitForSelector('#main .kpis');
  for (const [s, f] of [['bs','bs'],['invoices','inv'],['pp30','pp30'],['payroll','pay'],['cashflow','cf'],['bank','bank']]) {
    await p.evaluate((x) => { STATE.screen = x; STATE.sel = null; render(); }, s);
    await p.waitForTimeout(120);
    await p.screenshot({ path: 'shot-' + f + '.png' });
  }
  await p.evaluate(() => { STATE.screen = 'invoices'; render(); });
  await p.click('[data-act="new:invoice"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'shot-modal.png' });
  await b.close();
})();
