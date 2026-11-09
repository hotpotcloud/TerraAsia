// 单张定标截图：用经纬度机位拍一张，便于对比调参
// 用法: node scripts/shot.js <out.png> [lon] [lat] [dist] [az] [elev] [mode]
//   mode: flat | globe
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

(async () => {
  const out = process.argv[2] || 'shot.png';
  const lon = parseFloat(process.argv[3] || '104');
  const lat = parseFloat(process.argv[4] || '35');
  const dist = parseFloat(process.argv[5] || '70');
  const az = parseFloat(process.argv[6] || '0.6');
  const elev = parseFloat(process.argv[7] || '32');
  const mode = process.argv[8] || 'flat';

  const dir = resolveDist(null);
  if (!dir) failNoArtifact();

  const server = await serveDist(dir);
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('!!(window.__ta && document.querySelector(".scene-root canvas"))', { timeout: 45000 });
  // 等开场动画结束再拍，否则会拍到形变中途
  await page.waitForFunction('window.__ta.info().revealed === true', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(900);

  if (mode === 'globe') {
    await page.evaluate(() => window.__ta.view('globe'));
    await page.waitForTimeout(3200);
  } else {
    await page.evaluate(([a, b, c, d, e]) => window.__ta.camAt(a, b, c, d, e), [lon, lat, dist, az, elev]);
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: out });
  console.log(JSON.stringify({ out, errors: errs }, null, 2));
  await browser.close();
  server.close();
  process.exit(errs.length ? 1 : 0);
})();
