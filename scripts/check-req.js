// 需求层回归：城市划分 / POI 详情卡 / 地形派生图（坡度·坡向·等高线）
// 用法: node scripts/check-req.js
//
// 全部用条件轮询而不是固定 sleep：软件渲染（swiftshader）下帧率抖动很大。
// 退出码非 0 = 有断言失败，便于挂进 CI。
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

const OUT = 'shots/';
const log = [];
const fail = [];

(async () => {
  const dir = resolveDist(null);
  if (!dir) failNoArtifact();
  const server = await serveDist(dir);
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('[console] ' + m.text());
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('!!(window.__ta && document.querySelector(".scene-root canvas"))', { timeout: 45000 });
  await page.waitForFunction('window.__ta.info().revealed === true', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);

  /* —— 1. 城市划分 ——
     省域视角（lod 2）：应有市界、但**没有**市名（市名门槛在 lod 3）；
     再近一档（lod 3）：市名出现。两级都要量，否则「门槛抬高」这件事测不出来。

     计数只算「真的落在视口里」的标注：CSS2D 只对 object.visible 写 display:none，
     视锥外但投影仍有效的元素照样是 visible，光看 style.display 会把屏幕外的全算进来
     （曾因此把 20 来个市名误报成 375 个）。 */
  const onScreen = (sel) =>
    page.evaluate((q) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      return [...document.querySelectorAll(q)].filter((e) => {
        if (e.style.display === 'none') return false;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
      }).length;
    }, sel);

  /** 等 LOD 稳定到目标档：软件渲染下帧率可能只有 1 fps，固定 sleep 不可靠 */
  const waitLod = (n) =>
    page.waitForFunction((t) => window.__ta.info().lod === t, n, { timeout: 20000, polling: 100 });

  await page.evaluate(() => window.__ta.camAt(113, 32, 45, 0.3, 34));
  await waitLod(2).catch(() => {});
  await page.waitForTimeout(900);
  const lod2 = await page.evaluate(() => window.__ta.info().lod);
  const namesAtLod2 = await onScreen('.lb-cc');
  await page.screenshot({ path: OUT + 'v-citydiv-lod2.png' });

  await page.evaluate(() => window.__ta.camAt(113.6, 34.75, 28, 0.3, 34));
  await waitLod(3).catch(() => {});
  await page.waitForTimeout(900);
  const lod3 = await page.evaluate(() => window.__ta.info().lod);
  const namesAtLod3 = await onScreen('.lb-cc');
  await page.screenshot({ path: OUT + 'v-citydiv.png' });

  log.push({
    step: 'citydiv',
    lod2,
    namesAtLod2,
    lod3,
    namesAtLod3,
    poiLabels: await page.evaluate(() => document.querySelectorAll('.lb-poi').length),
  });

  // —— 2. POI 详情卡：飞到贡嘎山，点它的标注
  await page.evaluate(() => window.__ta.camAt(101.88, 29.6, 40, 0.5, 34));
  await page.waitForTimeout(1500);
  const clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.lb-poi')].find((e) => e.textContent === '贡嘎山');
    if (!el) return false;
    el.click();
    return true;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + 'v-poi.png' });
  log.push({
    step: 'poi',
    clicked,
    card: await page.evaluate(() => {
      const el = document.querySelector('.detail');
      if (!el) return null;
      return { title: el.querySelector('h3')?.textContent, text: el.textContent.slice(0, 160) };
    }),
  });

  // —— 3. 坡度派生图：打开图层面板 → 户外决策 → 坡度
  await page.evaluate(() => {
    const tb = [...document.querySelectorAll('button.tb')].find((b) => b.textContent.trim() === '图层');
    tb && tb.click();
  });
  await page.waitForTimeout(300);
  const slopeOk = await page.evaluate(() => {
    const d = [...document.querySelectorAll('details.grp')].find((x) =>
      (x.querySelector('summary')?.textContent || '').includes('户外决策'),
    );
    if (!d) return 'no-group';
    d.open = true;
    const btn = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === '坡度');
    if (!btn) return 'no-button';
    btn.click();
    return 'ok';
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + 'v-slope.png' });
  log.push({
    step: 'slope',
    slopeOk,
    legend: await page.evaluate(() => document.querySelector('.legend')?.textContent || null),
  });

  // —— 4. 坡向
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('details.grp')].find((x) =>
      (x.querySelector('summary')?.textContent || '').includes('户外决策'),
    );
    const btn = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === '坡向');
    btn && btn.click();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + 'v-aspect.png' });
  log.push({ step: 'aspect', legend: await page.evaluate(() => document.querySelector('.legend')?.textContent || null) });

  // —— 5. 等高线
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('details.grp')].find((x) =>
      (x.querySelector('summary')?.textContent || '').includes('户外决策'),
    );
    const btn = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === '等高线');
    btn && btn.click();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + 'v-contour.png' });
  log.push({ step: 'contour', legend: await page.evaluate(() => document.querySelector('.legend')?.textContent || null) });

  /* ---------- 断言 ---------- */
  const by = (s) => log.find((x) => x.step === s) || {};
  const cd = by('citydiv');
  if (cd.lod2 !== 2) fail.push(`省域视角 LOD 应为 2，实为 ${cd.lod2}`);
  if (cd.namesAtLod2 !== 0) fail.push(`省域视角不应出现市名，实有 ${cd.namesAtLod2} 个`);
  if (cd.lod3 !== 3) fail.push(`近景 LOD 应为 3，实为 ${cd.lod3}`);
  if (!(cd.namesAtLod3 > 0)) fail.push('近景一个市名都没显示');
  if (!(cd.poiLabels > 0)) fail.push('可点 POI 标注一个都没有');
  if (!by('poi').clicked) fail.push('点不到贡嘎山的标注');
  if (!by('poi').card?.title) fail.push('点击后详情卡没出来');
  if (!/坡度/.test(by('slope').legend || '')) fail.push('坡度图例缺失');
  if (!/坡向/.test(by('aspect').legend || '')) fail.push('坡向图例缺失');
  if (!/等高线/.test(by('contour').legend || '')) fail.push('等高线图例缺失');
  if (errs.length) fail.push(`页面报错 ${errs.length} 条`);

  console.log(JSON.stringify({ ok: fail.length === 0, fail, log, errors: errs }, null, 2));
  await browser.close();
  server.close();
  process.exit(fail.length ? 1 : 0);
})();
