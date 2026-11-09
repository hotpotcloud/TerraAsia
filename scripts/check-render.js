// 无头渲染校验：起本地静态服务 → 打开 dist 站点 → 收集 pageerror / 404 → 等就绪 → 截图
const { chromium } = require('playwright-core');
const { resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

// 用法: node scripts/check-render.js [dist 目录] [截图输出] [就绪等待毫秒]
(async () => {
  const dir = resolveDist(process.argv[2]);
  if (!dir) failNoArtifact();
  const shot = process.argv[3] || 'check.png';
  const waitMs = parseInt(process.argv[4] || '45000', 10);

  const server = await serveDist(dir);

  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  const bad404 = [];
  page.on('response', (r) => {
    if (r.status() === 404 && !/favicon/.test(r.url())) bad404.push(r.url());
  });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('[console] ' + m.text());
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  let ready = false;
  try {
    await page.waitForFunction("!!(window.__ta && document.querySelector('.scene-root canvas'))", { timeout: waitMs });
    ready = true;
  } catch (e) {
    /* 超时 */
  }
  // 等开场动画真正走完：软件渲染下首帧要编译一整轮地形着色器，可能卡好几秒，
  // 所以这里等状态而不是等固定时长
  await page
    .waitForFunction("window.__ta && window.__ta.info().revealed === true", { timeout: waitMs })
    .catch(() => {});
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.labels-layer .lb')];
    // 可见标注：CSS2DRenderer 用 display:none 关掉不可见的，所以排除掉它们
    const vis = els
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { t: el.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      })
      .filter((r) => r.w > 0 && r.h > 0);

    // 屏幕空间避让的验收：可见标注之间不应再有明显重叠（留 2px 容差）
    let overlaps = 0;
    for (let i = 0; i < vis.length; i++) {
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i];
        const b = vis[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 2 && oy > 2) overlaps++;
      }
    }

    return {
      hasCanvas: !!document.querySelector('.scene-root canvas'),
      loadingGone: !document.querySelector('.loading'),
      labelCount: els.length,
      labelVisible: vis.length,
      labelOverlaps: overlaps,
      detail: window.__ta ? window.__ta.info() : null,
    };
  });

  await page.screenshot({ path: shot });
  await browser.close();
  server.close();

  errors.push(...bad404.map((u) => '[404] ' + u));
  const ok =
    ready &&
    info.hasCanvas &&
    info.loadingGone &&
    // 全被避让掉也是回归：标注是主要内容，不能一枚都不剩
    info.labelVisible >= 6 &&
    info.labelOverlaps === 0 &&
    errors.length === 0;
  console.log(JSON.stringify({ ok, ready, ...info, errors }, null, 2));
  process.exit(ok ? 0 : 1);
})();
