// 功能回归：省界点选、双模式切换、图层开关、夸张滑块、导览步进
// 用法: node scripts/check-func.js
//
// 这里所有等待都用「轮询到条件成立」而不是 sleep 固定时长 —— 软件渲染（swiftshader）
// 下帧率抖动很大，固定时长会让回归变成随机测试。
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

(async () => {
  const dir = resolveDist(null);
  if (!dir) failNoArtifact();

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

  /** 等开场动画跑完（uReveal 到 1），否则中途点选会被形变带偏 */
  const waitReady = () =>
    page.waitForFunction('window.__ta && window.__ta.info().revealed !== false', { timeout: 30000 }).catch(() => {});
  const waitMix = (target) =>
    page.waitForFunction(
      (t) => Math.abs(window.__ta.info().mix - t) < 0.02,
      target,
      { timeout: 30000, polling: 120 },
    );

  await page.waitForTimeout(4000);
  await waitReady();
  await waitMix(0);

  const out = {};
  const clickLabel = (text) =>
    page.evaluate((t) => {
      const hit = [...document.querySelectorAll('.chk')].find((l) => l.textContent.includes(t));
      if (!hit) return false;
      hit.querySelector('input').click();
      return true;
    }, text);

  // 1) 打开省界并点选青海（点画布正中 = 机位对准的经纬度）
  // 先打开图层面板（新 UI 面板默认关闭，需通过顶栏工具入口打开）
  await page.evaluate(() => {
    const tb = [...document.querySelectorAll('button.tb')].find((b) => b.textContent.trim() === '图层');
    tb && tb.click();
  });
  await page.waitForTimeout(300);
  out.provToggle = await clickLabel('省界');
  await page.evaluate(() => window.__ta.camAt(100.5, 35.4, 42, 0.5, 40));
  // 拾取走的是相机矩阵，等一帧让它落到新机位（camAt 已同步刷新，这里只是兜底）
  await page.waitForTimeout(500);
  const box = await page.locator('.scene-root canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction('!!document.querySelector(".prov-name")', { timeout: 10000 }).catch(() => {});
  out.selectedProv = await page.evaluate(() => document.querySelector('.prov-name')?.textContent ?? null);
  out.pick = await page.evaluate(() => window.__ta.pick(0, 0));

  // 2) 切地球 → 再切回（等 mix 真正到位，而不是猜时长）
  await page.evaluate(() => window.__ta.view('globe'));
  await waitMix(1);
  out.globeMix = await page.evaluate(() => window.__ta.info().mix);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/func-globe.png' });

  await page.evaluate(() => window.__ta.view('flat'));
  await waitMix(0);
  out.flatMix = await page.evaluate(() => window.__ta.info().mix);

  // 3) 图层开关（先切到图层面板，交通/自然地理分组可能折叠，展开后点选）
  await page.evaluate(() => {
    // 打开图层面板
    const tb = [...document.querySelectorAll('button.tb')].find((b) => b.textContent.trim() === '图层');
    tb && tb.click();
  });
  await page.waitForTimeout(300);
  for (const t of ['铁路', '公路', '阶梯分界', '河流']) await clickLabel(t);
  await page.waitForTimeout(400);

  // 4) 夸张滑块拉满（重建几何 + 重算法线）—— 需先切到画面面板
  await page.evaluate(() => {
    const tb = [...document.querySelectorAll('button.tb')].find((b) => b.textContent.trim() === '画面');
    tb && tb.click();
  });
  await page.waitForTimeout(300);
  // 注意：受控 input 直接赋 .value 会被 React 的 value tracker 吞掉（认为值没变 →
  // 不触发 onChange）。必须走 HTMLInputElement.prototype 上的原生 setter 再派发 input。
  const exagSet = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ctl')].find(
      (el) => el.querySelector('label')?.textContent.trim() === '地形起伏',
    );
    const s = row && row.querySelector('input[type=range]');
    if (!s) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(s, s.max);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return s.max;
  });
  out.exagTarget = exagSet ? parseFloat(exagSet) : null;
  await page.waitForFunction((t) => window.__ta.info().exag === t, out.exagTarget, { timeout: 15000 }).catch(() => {});
  out.exag = await page.evaluate(() => window.__ta.info().exag);
  await page.waitForTimeout(1200);

  // 5) 导览步进（切到导览面板）
  await page.evaluate(() => {
    const tb = [...document.querySelectorAll('button.tb')].find((b) => b.textContent.trim() === '导览');
    tb && tb.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__ta.step(2));
  await page.waitForFunction('document.querySelector(".step-name")?.textContent.includes("3 / 6")', {
    timeout: 15000,
  }).catch(() => {});
  out.step = await page.evaluate(() => document.querySelector('.step-name')?.textContent ?? null);

  await page.screenshot({ path: 'shots/func-flat.png' });
  await browser.close();
  server.close();

  const ok =
    out.provToggle === true &&
    out.selectedProv === '青海省' &&
    out.globeMix > 0.98 &&
    out.flatMix < 0.02 &&
    out.exag === out.exagTarget &&
    out.exag === 16 &&
    /^3 \/ 6/.test(out.step || '') &&
    errs.length === 0;
  console.log(JSON.stringify({ ok, ...out, errors: errs }, null, 2));
  process.exit(ok ? 0 : 1);
})();
