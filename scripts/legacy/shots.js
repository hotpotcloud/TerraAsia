// 多状态截图: 开场中点 / 总览 / 各阶梯步骤 / 南海特写
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__geo3dReady===true', { timeout: 30000 });

  await page.waitForTimeout(2300);
  await page.screenshot({ path: 'shot_reveal.png' });      // 开场中段
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'shot_overview.png' });    // 总览(揭示完成)

  for (let i = 1; i <= 3; i++) {
    await page.click('#btnNext');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `shot_step${i + 1}.png` });
  }
  // 河流步骤
  await page.click('#btnNext');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'shot_step5.png' });

  // 开省界 + 南海特写(滚轮拉近 + 平移)
  await page.click('#ckProv');
  await page.evaluate(() => { window.__cam && window.__cam(); });
  await page.screenshot({ path: 'shot_prov.png' });

  console.log(JSON.stringify({ errors: errs }));
  await browser.close(); server.close();
})();
