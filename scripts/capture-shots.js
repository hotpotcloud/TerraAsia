// 文档配图：把 docs/img/ 下的四张图重拍一遍（README 与 docs/01 引用）
// 用法: node scripts/capture-shots.js [输出目录]   默认 docs/img
//
// 每张图都等「开场动画结束」再拍，避免拍到形变中途的中间态。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

(async () => {
  const dir = resolveDist(null);
  if (!dir) failNoArtifact();
  const outDir = path.resolve(process.argv[2] || 'docs/img');
  fs.mkdirSync(outDir, { recursive: true });

  const server = await serveDist(dir);
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push('[console] ' + m.text());
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('!!(window.__ta && document.querySelector(".scene-root canvas"))', { timeout: 45000 });
  await page.waitForFunction('window.__ta.info().revealed === true', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);

  /** 落位到指定机位并等标注稳定 */
  const shoot = async (file, pose) => {
    if (pose) {
      await page.evaluate((p) => window.__ta.camAt(p.lon, p.lat, p.dist, p.az, p.el), pose);
      await page.waitForTimeout(1400);
    }
    const out = path.join(outDir, file);
    await page.screenshot({ path: out });
    console.log('· ' + path.relative(process.cwd(), out));
  };

  // 1) 封面：亚洲全景，中国在正中偏东
  await shoot('hero.png', { lon: 101, lat: 50, dist: 286, az: 0.3, el: 48 });

  // 2) 聚焦中国：三级阶梯全貌
  await shoot('china.png', { lon: 104, lat: 35, dist: 150, az: 0.49, el: 38 });

  // 3) 喜马拉雅近景：雪线、山脊阴影、境内外色差
  await shoot('himalaya.png', { lon: 84.0, lat: 27.0, dist: 40, az: 0.5, el: 30 });

  // 4) 地球模式：整颗星球 + 世界地图
  await page.evaluate(() => window.__ta.view('globe'));
  await page.waitForFunction('window.__ta.info().mix > 0.98', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shoot('globe.png');
  await page.evaluate(() => window.__ta.view('flat'));

  const info = await page.evaluate(() => window.__ta.info());
  console.log(JSON.stringify({ outDir, shots: 4, lastInfo: info, errors: errs }, null, 2));

  await browser.close();
  server.close();
  process.exit(errs.length ? 1 : 0);
})();
