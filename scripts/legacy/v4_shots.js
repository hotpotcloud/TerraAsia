// v4 定标: 地形立体感 / 地级市界 / 高夸张
const { chromium } = require('playwright-core');
const http = require('http'), path = require('path'), fs = require('fs');

(async () => {
  const html = path.resolve(process.argv[2]);
  const dir = path.dirname(html);
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
      fs.createReadStream(p).pipe(res);
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/` + encodeURIComponent(path.basename(html));

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__geo3dReady===true', { timeout: 30000 });
  await page.waitForTimeout(7500);

  const shot = async (n, ms = 1600) => { await page.waitForTimeout(ms); await page.screenshot({ path: n }); };

  // 1 总览(新立体感 + 9.5×)
  await shot('v4_s1_overview.png', 300);

  // 2 点选四川 → 地级市界
  await page.evaluate(() => window.__flyTo(102.8, 30.4, 42, 0.25));
  await page.waitForTimeout(1500);
  await page.click('#ckProv');
  await page.waitForTimeout(600);
  const box = await page.evaluate(() => {
    const c = document.querySelector('#app canvas').getBoundingClientRect();
    return { x: c.left + c.width * 0.47, y: c.top + c.height * 0.47 };
  });
  await page.mouse.click(box.x, box.y);
  await shot('v4_s2_sichuan_city.png', 1800);
  const info1 = await page.evaluate(() => ({
    prov: (document.querySelector('#provName') || {}).textContent,
    cityLabels: [...document.querySelectorAll('#labels .lb-cc')].filter(e => e.style.display !== 'none').length,
    cityLabelsAll: document.querySelectorAll('#labels .lb-cc').length
  }));

  // 3 青藏高原近景: 看等高带与光影
  await page.evaluate(() => { window.__flyTo(88.5, 31.0, 34, 0.4); });
  await shot('v4_s3_relief.png', 2000);

  // 4 立体感拉到 20×
  await page.evaluate(() => {
    const el = document.querySelector('#exag');
    el.value = '20'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  });
  await page.evaluate(() => { window.__flyTo(95.0, 33.0, 52, 0.5); });
  await shot('v4_s4_exag20.png', 2200);

  // 5 江苏: 市多且密集
  await page.evaluate(() => {
    const el = document.querySelector('#exag');
    el.value = '9.5'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
    window.__flyTo(119.5, 33.2, 26, 0.3);
  });
  await page.waitForTimeout(1600);
  await page.mouse.click(box.x, box.y);
  await shot('v4_s5_jiangsu_city.png', 1800);
  const info2 = await page.evaluate(() => ({ prov: (document.querySelector('#provName') || {}).textContent }));

  console.log(JSON.stringify({ info1, info2, errs }, null, 2));
  await browser.close(); server.close();
})();
