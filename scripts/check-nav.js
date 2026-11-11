// 机位导航回归：平面 / 地球两种形态下，「全景」「中国」「导览位」必须落到同一个经纬度。
//
// 曾经的 bug：三个快捷键都用平面世界坐标算机位，球面模式下相机被甩到北极上空
// （世界坐标 y≈150，而地球半径只有 110）。这个脚本直接反解相机落点的经纬度来判，
// 不依赖任何内部状态。
//
// 用法: node scripts/check-nav.js
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

const fail = [];
const log = [];
const R = 110; // EARTH_R，与 app/src/data/globe.ts 一致

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
  await page.waitForTimeout(1500);

  const clickTb = (label) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll('button.tb')].find((x) => x.textContent.trim() === t);
      if (!b) return false;
      b.click();
      return true;
    }, label);

  const waitMix = (target) =>
    page.waitForFunction((t) => Math.abs(window.__ta.info().mix - t) < 0.02, target, {
      timeout: 30000,
      polling: 120,
    });

  /**
   * 等相机补间真正落位。
   *
   * 不能固定 sleep：headless 的 SwiftShader 只有约 0.5 fps，一帧要 2 s，
   * 1800 ms 的补间可能一帧都没跑完。判据用 `animLeft === null`（补间已结束）
   * 外加视距落在期望值上，两者同时成立才算落位。
   */
  const waitCam = (expectDist, tol = 6) =>
    page.waitForFunction(
      ([d, t]) => {
        const i = window.__ta.info();
        return i.animLeft === null && Math.abs(i.camDist - d) <= t;
      },
      [expectDist, tol],
      { timeout: 45000, polling: 200 },
    );

  /** 读相机：球面模式下相机指向地心，可直接反解出落点经纬度 */
  const readCam = () =>
    page.evaluate(() => {
      const c = window.__ta.cam();
      const [x, y, z] = c.pos;
      const r = Math.hypot(x, y, z);
      return {
        pos: c.pos,
        tgt: c.tgt,
        r: +r.toFixed(1),
        lon: +((Math.atan2(x, z) * 180) / Math.PI).toFixed(1),
        lat: +((Math.asin(y / r) * 180) / Math.PI).toFixed(1),
        distToTgt: +Math.hypot(x - c.tgt[0], y - c.tgt[1], z - c.tgt[2]).toFixed(1),
      };
    });

  /* ---------- 球面模式 ---------- */
  await clickTb('地球');
  await waitMix(1);
  await page.waitForTimeout(600);

  const targets = [
    ['中国', 104, 35, 150],
    ['导览位', 101, 50, 286],
    ['全景', 101, 50, 286],
  ];

  for (const [label, lon, lat, flatDist] of targets) {
    const okClick = await clickTb(label);
    const expectR = Math.min(R * 3.1, Math.max(R * 1.35, R + flatDist * 0.62));
    await waitCam(expectR).catch(() => {});
    const c = await readCam();
    const dLon = Math.abs(c.lon - lon);
    const dLat = Math.abs(c.lat - lat);
    log.push({ mode: 'globe', label, clicked: okClick, expect: { lon, lat, r: +expectR.toFixed(1) }, got: c });
    if (!okClick) fail.push(`球面模式点不到「${label}」`);
    if (dLon > 2.5) fail.push(`球面「${label}」经度偏了：期望 ${lon}，实为 ${c.lon}`);
    if (dLat > 2.5) fail.push(`球面「${label}」纬度偏了：期望 ${lat}，实为 ${c.lat}`);
    if (Math.abs(c.r - expectR) > 6) fail.push(`球面「${label}」视距异常：期望 ${expectR.toFixed(0)}，实为 ${c.r}`);
  }
  await page.screenshot({ path: 'shots/v-globe-cn.png' });

  /* ---------- 切回平面：同一组快捷键的视距必须回来 ---------- */
  await clickTb('平面');
  await waitMix(0);
  await page.waitForTimeout(600);

  const okFlat = await clickTb('中国');
  await waitCam(150).catch(() => {});
  const fc = await readCam();
  log.push({ mode: 'flat', label: '中国', clicked: okFlat, got: fc });
  if (!okFlat) fail.push('平面模式点不到「中国」');
  if (Math.abs(fc.distToTgt - 150) > 8) fail.push(`平面「中国」视距异常：期望 ~150，实为 ${fc.distToTgt}`);
  /* 平面模式的目标点必须落在世界坐标里（|x|、|z| 都是百量级），
     而不是球面那种半径 110 的落点 */
  if (Math.abs(fc.tgt[1]) > 12) fail.push(`平面「中国」目标点高度异常：y=${fc.tgt[1]}`);

  if (errs.length) fail.push(`页面报错 ${errs.length} 条`);

  console.log(JSON.stringify({ ok: fail.length === 0, fail, log, errors: errs }, null, 2));
  await browser.close();
  server.close();
  process.exit(fail.length ? 1 : 0);
})();
