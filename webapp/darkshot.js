const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await p.goto('file://' + path.join(__dirname, 'index.html'));
  await p.waitForSelector('#main .kpis');
  await p.screenshot({ path: 'shot-dark.png' });
  await b.close();
})();
