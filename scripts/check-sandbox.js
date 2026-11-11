// 沙盘形态回归：地形块必须是有厚度的实体模型，且在正确的形态下收起。
//
// 判据只读 `__ta.info().wall` —— 断面侧壁的当前不透明度：
//   · 平面 + 底座开 → 1
//   · 平面 + 底座关 → 0（退回地形图形态）
//   · 球面         → 0（星球上不该出现一块矩形断面）
// 曾经的坑：侧壁几何写好了但材质色按线性空间给值，断面亮成一条白边；
// 这张脚本不判颜色，只判「有没有」「该不该有」，配色靠截图人眼把关。
//
// 用法: node scripts/check-sandbox.js
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
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('[console] ' + m.text());
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('!!(window.__ta && document.querySelector(".scene-root canvas"))', { timeout: 45000 });
  await page.waitForFunction('window.__ta.info().revealed === true', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);

  /* 软件渲染只有约 0.5 fps，一帧 2 s；一律轮询到位，不用固定 sleep */
  const waitWall = (target, tol = 0.06) =>
    page.waitForFunction(
      ([t, d]) => Math.abs(window.__ta.info().wall - t) <= d,
      [target, tol],
      { timeout: 30000, polling: 150 },
    );
  const waitMix = (target) =>
    page.waitForFunction((t) => Math.abs(window.__ta.info().mix - t) < 0.02, target, {
      timeout: 30000,
      polling: 120,
    });
  const wall = () => page.evaluate(() => window.__ta.info().wall);

  const clickTb = (label) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll('button.tb')].find((x) => x.textContent.trim() === t);
      if (!b) return false;
      b.click();
      return true;
    }, label);

  /** 点「沙盘底座」勾选框，返回是否点到 */
  const toggleSandbox = () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll('label.chk')].find((l) =>
        (l.textContent || '').includes('沙盘底座'),
      );
      const box = el && el.querySelector('input[type=checkbox]');
      if (!box) return null;
      box.click();
      return box.checked;
    });

  /* ---------- 1. 默认：平面形态 + 底座开 ---------- */
  await waitWall(1).catch(() => {});
  const w0 = await wall();
  await page.evaluate(() => window.__ta.camAt(120, 20, 210, 0.9, 16));
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shots/v-sandbox-on.png' });
  log.push({ step: 'default', wall: w0 });
  if (w0 < 0.9) fail.push(`默认应显示断面侧壁，实际不透明度 ${w0}`);

  /* ---------- 2. 关掉底座：退回地形图形态 ---------- */
  await clickTb('画面');
  await page.waitForTimeout(300);
  const off = await toggleSandbox();
  if (off === null) fail.push('找不到「沙盘底座」勾选框');
  await waitWall(0).catch(() => {});
  const w1 = await wall();
  await page.screenshot({ path: 'shots/v-sandbox-off.png' });
  log.push({ step: 'sandbox-off', checked: off, wall: w1 });
  if (w1 > 0.05) fail.push(`关闭底座后侧壁应收起，实际不透明度 ${w1}`);

  /* ---------- 3. 重新打开，再切球面：必须淡出 ---------- */
  const on = await toggleSandbox();
  await waitWall(1).catch(() => {});
  const w2 = await wall();
  log.push({ step: 'sandbox-back', checked: on, wall: w2 });
  if (w2 < 0.9) fail.push(`重新开启底座后侧壁未恢复，实际不透明度 ${w2}`);

  await clickTb('地球');
  await waitMix(1);
  await waitWall(0).catch(() => {});
  const w3 = await wall();
  await page.screenshot({ path: 'shots/v-sandbox-globe.png' });
  log.push({ step: 'globe', wall: w3 });
  if (w3 > 0.05) fail.push(`球面模式下侧壁应收起，实际不透明度 ${w3}`);

  /* ---------- 4. 切回平面：断面要自己回来 ---------- */
  await clickTb('平面');
  await waitMix(0);
  await waitWall(1).catch(() => {});
  const w4 = await wall();
  log.push({ step: 'back-flat', wall: w4 });
  if (w4 < 0.9) fail.push(`切回平面后侧壁未恢复，实际不透明度 ${w4}`);

  if (errs.length) fail.push(`页面报错 ${errs.length} 条`);

  console.log(JSON.stringify({ ok: fail.length === 0, fail, log, errors: errs }, null, 2));
  await browser.close();
  server.close();
  process.exit(fail.length ? 1 : 0);
})();
