const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const scr = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const dark = process.env.DARK === '1';
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: dark ? 'dark' : 'light' });
  await p.goto('file://' + path.join(__dirname, 'index.html'));
  await p.waitForSelector('#main .kpis');
  for (const s of (scr.length ? scr : ['dashboard'])) {
    await p.evaluate((x) => { STATE.screen = x; STATE.sel = null; render(); }, s);
    await p.waitForTimeout(150);
    await p.screenshot({ path: 'shot-' + s + (dark ? '-dark' : '') + '.png', fullPage: s === 'dashboard' });
  }
  await b.close();
})();
