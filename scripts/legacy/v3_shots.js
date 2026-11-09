// v3 定标截图: 默认总览 / 铁路公路(带线名) / 近景山峰景区 / 阶梯分界线
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
  await page.waitForTimeout(7000);

  const shot = async (n, ms = 1500) => { await page.waitForTimeout(ms); await page.screenshot({ path: n }); };
  const vis = () => page.evaluate(() => {
    const c = s => [...document.querySelectorAll('#labels .lb-' + s)].filter(e => e.style.display !== 'none').length;
    return { m: c('m'), t: c('t'), w: c('w'), r: c('r'), c1: c('c1'), c2: c('c2'),
             s: c('s'), v: c('v'), rl: c('rl'), rd: c('rd'), l: c('l'), n: c('n'),
             lod: window.__info().lodT, camD: window.__info().camD };
  });

  await shot('v3_s1_overview.png', 300);
  const atOverview = await vis();

  // 中景 + 铁路/公路
  await page.evaluate(() => window.__flyTo(114.0, 34.6, 46, 0.7));
  await page.click('#ckRail'); await page.click('#ckRoad');
  await shot('v3_s2_trans.png', 2200);
  const atTrans = await vis();

  // 近景: 山峰·景区
  await page.evaluate(() => window.__flyTo(103.4, 30.6, 26, 0.35));
  await shot('v3_s3_scenic.png', 2200);
  const atNear = await vis();

  // 阶梯分界线(默认关 → 打开)
  await page.click('#ckTierLine');
  await page.evaluate(() => window.__flyTo(108.0, 38.0, 40, 0.85));
  await shot('v3_s4_tier.png', 2200);

  // 总览(交通开)
  await page.evaluate(() => window.__flyTo(104.0, 35.0, 96, 0.55));
  await shot('v3_s5_trans_overview.png', 2400);

  console.log(JSON.stringify({ atOverview, atTrans, atNear, errs }, null, 2));
  await browser.close(); server.close();
})();
