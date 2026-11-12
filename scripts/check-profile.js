// 线路剖面回归（docs/10 R03b）
//
// 判据：
//   1. 顶栏「剖面」进入取点模式，出现提示条
//   2. 点两处陆地 → 出现剖面面板，横向是地面里程、纵向是真实海拔
//   3. 数值自洽：总长 > 0，最高 ≥ 最低，爬升/下降非负
//   4. 断点不虚构高程：这条线全部落在亚洲图幅内，断点数必须为 0
//
// 用法: node scripts/check-profile.js
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

const fail = [];
const log = [];

(async () => {
  const dir = resolveDist(null);
  if (!dir) failNoArtifact();
  const server = await serveDist(dir);
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) {
      errs.push('[console] ' + m.text());
    }
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('!!(window.__ta && document.querySelector(".scene-root canvas"))', { timeout: 45000 });
  await page.waitForFunction(() => window.__ta.info().revealed === true, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const clickTb = (label) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll('button.tb')].find((x) => x.textContent.trim() === t);
      if (!b) return false;
      b.click();
      return true;
    }, label);

  /* ---------- 1. 进入取点 ---------- */
  const entered = await clickTb('剖面');
  await page.waitForTimeout(400);
  const hint = await page.evaluate(() => document.querySelector('.pf-hint')?.textContent || null);
  log.push({ step: 'enter', entered, hint });
  if (!entered) fail.push('找不到「剖面」按钮');
  if (!hint || !/起点/.test(hint)) fail.push(`进入取点后应有起点提示，实际：${hint}`);

  /* ---------- 2. 点两处陆地 ----------
     先在地面上找两个确实能拾到经纬度的屏幕位置，再按真实点击走过去，
     这样测的是「用户真点两下」的完整链路，而不是直接调 store。 */
  const spot = (nx, ny) =>
    page.evaluate(([x, y]) => {
      const h = window.__ta.pick(x, y);
      return h ? { lon: h.lon, lat: h.lat } : null;
    }, [nx, ny]);

  const W = 1600;
  const H = 950;
  const toPage = (nx, nyv) => [(nx + 1) / 2 * W, (1 - nyv) / 2 * H];

  const cands = [
    [-0.36, -0.10],
    [0.22, -0.02],
    [-0.10, 0.06],
    [0.40, -0.16],
  ];
  const hits = [];
  for (const [nx, ny] of cands) {
    const h = await spot(nx, ny);
    if (h) hits.push({ nx, ny, h });
  }
  log.push({ step: 'candidates', hits: hits.map((x) => x.h) });
  if (hits.length < 2) fail.push('地面拾取点不足两个，无法画线');

  for (const c of hits.slice(0, 2)) {
    const [px, py] = toPage(c.nx, c.ny);
    await page.mouse.click(px, py);
    await page.waitForTimeout(500);
  }

  const panel = await page
    .waitForFunction(() => !!document.querySelector('.profile'), null, { timeout: 15000, polling: 200 })
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: 'shots/v-profile.png' });
  if (!panel) {
    fail.push('点完两处后没有出现剖面面板');
  } else {
    const info = await page.evaluate(() => {
      const el = document.querySelector('.profile');
      const paths = el.querySelectorAll('svg path').length;
      return {
        meta: el.querySelector('.pf-meta')?.textContent || '',
        foot: el.querySelector('.pf-foot')?.textContent || '',
        paths,
      };
    });
    log.push({ step: 'panel', ...info });
    const km = parseFloat((info.meta.match(/([\d.]+)\s*km/) || [])[1] || '0');
    const gain = parseFloat((info.meta.match(/爬升\s*([\d.]+)/) || [])[1] || '0');
    const loss = parseFloat((info.meta.match(/下降\s*([\d.]+)/) || [])[1] || '0');
    const maxE = parseFloat((info.foot.match(/最高\s*(-?[\d.]+)/) || [])[1] || '0');
    const minE = parseFloat((info.foot.match(/最低\s*(-?[\d.]+)/) || [])[1] || '0');
    log.push({ step: 'values', km, gain, loss, maxE, minE });
    if (!(km > 0)) fail.push(`线路总长异常：${km} km`);
    if (!(gain >= 0) || !(loss >= 0)) fail.push(`爬升/下降出现负值：${gain}/${loss}`);
    if (!(maxE >= minE)) fail.push(`最高/最低海拔矛盾：${maxE}/${minE}`);
    if (info.paths < 1) fail.push('剖面 SVG 没有画出曲线');
    if (/数据缺失/.test(info.foot)) fail.push(`图幅内的线路不应有断点：${info.foot}`);
  }

  /* ---------- 3. 清除 ---------- */
  await page.evaluate(() => {
    const b = document.querySelector('.profile .pf-x');
    b && b.click();
  });
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => !document.querySelector('.profile'));
  log.push({ step: 'clear', gone });
  if (!gone) fail.push('点关闭后剖面面板未消失');

  if (errs.length) fail.push(`页面报错 ${errs.length} 条`);

  console.log(JSON.stringify({ ok: fail.length === 0, fail, log, errors: errs }, null, 2));
  await browser.close();
  server.close();
  process.exit(fail.length ? 1 : 0);
})();
