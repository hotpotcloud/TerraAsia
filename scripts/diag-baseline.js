#!/usr/bin/env node
/**
 * 渲染基线诊断（依据 docs/07-React项目渲染修复方案.md 第四节 1-4 步）。
 *
 * 目的：在**同一份产物、同一机位、同一组参数**下，产出可重复的数值与画面证据，
 * 用于分离「数据 / 几何 / 双层覆盖 / 光照与 AO」四类原因。
 * 本脚本只做观测与临时隔离，不修改业务代码；每项实验结束都恢复完整能力，
 * 最后一张 full-restored 用于确认恢复成功。截图与 JSON 一起落盘，便于逐项复核。
 *
 * 用法：
 *   node scripts/diag-baseline.js                 # 软件渲染（可重复环境）
 *   node scripts/diag-baseline.js --headed       # 真实 GPU 浏览器（默认 Edge，非 headless）
 *   node scripts/diag-baseline.js --out=shots/diag/run-xxx
 *
 * 说明：隔离实验的结论只用于定位，不能作为「修复完成」的证据（见 docs/08 第二节）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');
const { ROOT, DIST, resolveDist, failNoArtifact } = require('./lib/artifacts');
const { serveDist, LAUNCH } = require('./lib/serve');

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const outArg = argv.find((a) => a.startsWith('--out='));
const envName = headed ? 'gpu' : 'swiftshader';
const outDir = path.resolve(ROOT, outArg ? outArg.slice(6) : path.join('shots', 'diag', envName));
fs.mkdirSync(outDir, { recursive: true });

/**
 * 固定机位。dist 是世界单位：286 为初始全景；25/18 才是真正「放大后」的局部近景。
 * 早期用 dist=55 拍到的仍是覆盖数十个经度的广域视图，无法暴露细节伪影，已修正。
 * 隔离矩阵固定在 VIEWS[1]（hengduan-25）。
 */
const VIEWS = [
  { id: 'panorama', lon: 101, lat: 50, dist: 286, az: 0.3, elev: 48, note: '初始全景对照' },
  { id: 'hengduan-25', lon: 102, lat: 33, dist: 25, az: 0.3, elev: 42, note: '用户反馈的放大坑洼区域' },
  { id: 'hengduan-18', lon: 102, lat: 33, dist: 18, az: 0.3, elev: 42, note: '极限近景' },
  { id: 'loess-25', lon: 108, lat: 36, dist: 25, az: 0.3, elev: 42, note: '黄土—华北对照区域' },
  { id: 'west-edge', lon: 30, lat: 45, dist: 60, az: 0.3, elev: 42, note: '亚洲覆盖西边界' },
];

/** 隔离矩阵：world/asia 为网格可见性，ao/shadow 为片元链路开关 */
const VARIANTS = [
  { id: '00-full', world: true, asia: true, ao: true, shadow: true },
  { id: '01-noWorld', world: false, asia: true, ao: true, shadow: true },
  { id: '02-noAO', world: true, asia: true, ao: false, shadow: true },
  { id: '03-noShadow', world: true, asia: true, ao: true, shadow: false },
  { id: '04-geoOnly', world: false, asia: true, ao: false, shadow: false },
  { id: '05-worldOnly', world: true, asia: false, ao: true, shadow: true },
  { id: '06-full-restored', world: true, asia: true, ao: true, shadow: true },
];

function sha12(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

/**
 * 按「渲染帧」而非固定时间等待。
 * 固定 sleep 在软件渲染下会截到滞后的旧帧（相机已改、画面未重绘），
 * 导致同机位隔离实验拿到错误证据；rAF 计数可确认浏览器确实推进了帧。
 */
async function armFrameCounter(page) {
  await page.evaluate(() => {
    window.__diagFrames = 0;
    const tick = () => { window.__diagFrames += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

/**
 * 帧数按环境自适应：真实 GPU 约 144fps，软件渲染实测约 1fps。
 * 软件渲染下无法在合理时间内等足够多帧，结果会标记为 degraded（有限证据）。
 */
const FRAMES_PER_STEP = headed ? 12 : 3;
const FRAME_TIMEOUT = headed ? 30000 : 60000;

async function waitFrames(page, n = FRAMES_PER_STEP) {
  const start = await page.evaluate(() => window.__diagFrames);
  await page.waitForFunction(
    ([s, k]) => window.__diagFrames >= s + k,
    [start, n],
    { timeout: FRAME_TIMEOUT },
  );
  await page.waitForTimeout(120);
}

async function measureFps(page, ms = 1500) {
  const a = await page.evaluate(() => window.__diagFrames);
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => window.__diagFrames);
  return +(((b - a) / ms) * 1000).toFixed(1);
}

async function shot(page, file) {
  const buf = await page.screenshot({ path: file });
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

function buildMeta() {
  let commit = null;
  let dirty = null;
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  } catch (e) {
    commit = `unavailable: ${e.message}`;
  }
  const entry = fs.readdirSync(path.join(DIST, 'assets'))
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ file: f, sha12: sha12(path.join(DIST, 'assets', f)) }));
  const data = fs.readdirSync(path.join(DIST, 'data'))
    .filter((f) => fs.statSync(path.join(DIST, 'data', f)).isFile())
    .map((f) => {
      const p = path.join(DIST, 'data', f);
      return { file: f, bytes: fs.statSync(p).size, sha12: sha12(p) };
    });
  return { commit, dirtyFiles: dirty, entry, data, generatedAt: new Date().toISOString() };
}

(async () => {
  const dir = resolveDist(null);
  if (!dir) failNoArtifact();
  const meta = buildMeta();

  const launch = headed
    ? { executablePath: LAUNCH.executablePath, headless: false, args: ['--disable-gpu-sandbox'] }
    : LAUNCH;

  const server = await serveDist(dir);
  let browser;
  const result = {
    meta,
    environment: {
      mode: headed ? 'headed-real-gpu' : 'headless-swiftshader',
      executablePath: launch.executablePath,
      headless: launch.headless,
      args: launch.args,
      viewport: { width: 1600, height: 950 },
      dist: dir,
    },
    browser: null,
    errors: [],
    ready: false,
    state: null,
    views: [],
    variants: [],
    probes: [],
    layerProbes: [],
    frames: null,
    uniforms: null,
    failure: null,
  };

  try {
    browser = await chromium.launch(launch);
    const page = await browser.newPage({ viewport: result.environment.viewport });
    page.on('pageerror', (e) => result.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') result.errors.push(`console: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) result.errors.push(`http ${r.status()}: ${r.url()}`);
    });

    await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      '!!(window.__ta && document.querySelector(".scene-root canvas"))',
      { timeout: 60000 },
    );
    await page.waitForFunction('window.__ta.info().revealed === true', { timeout: 90000 });
    await armFrameCounter(page);
    result.environment.measuredFps = await measureFps(page);
    result.environment.frameSync = headed ? 'reliable' : 'degraded';
    result.environment.framesPerStep = FRAMES_PER_STEP;
    await waitFrames(page, headed ? 20 : 5);
    result.ready = true;

    // 浏览器 / GPU 身份：软件渲染与真实 GPU 必须分开记录，不能混为一谈
    result.browser = await page.evaluate(() => {
      const c = document.querySelector('.scene-root canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return {
        ua: navigator.userAgent,
        renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl && gl.getParameter(gl.RENDERER),
        vendor: e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : gl && gl.getParameter(gl.VENDOR),
        version: gl && gl.getParameter(gl.VERSION),
      };
    });

    // 关键状态：夸张比、太阳、视图、图层、动画完成状态、两层对位
    result.state = await page.evaluate(() => ({
      info: window.__ta.info(),
      cam: window.__ta.cam(),
      store: {
        // 只取与画面相关的字段，避免把整个 zustand 对象序列化
        exag: document.querySelector('.ctl input[type=range]')?.value ?? null,
      },
    }));
    result.frames = await page.evaluate(() => window.__ta.frames());
    result.uniforms = await page.evaluate(() => {
      const u = window.__ta.uniforms();
      if (!u) return null;
      const dim = (t) => (t && t.image ? { w: t.image.width, h: t.image.height } : null);
      return {
        uExag: u.uExag.value,
        uShadowOn: u.uShadowOn.value,
        uAOAmt: u.uAOAmt.value,
        uReveal: u.uReveal.value,
        uGlobe: u.uGlobe.value,
        uEdgeMode: u.uEdgeMode.value,
        uSun: u.uSun.value.toArray(),
        aoTex: dim(u.uAO.value),
        heightTex: dim(u.uHeight.value),
        selTex: dim(u.uSel.value),
      };
    });

    // 数值证据：选定经纬度直接读装载后的数值场，不依赖画面猜测
    const pts = [[102, 33], [100, 35], [108, 36], [95, 30], [90, 28], [116, 40], [122, 31], [105, 25]];
    result.probes = await page.evaluate(
      (pts) => pts.map(([lon, lat]) => ({ lon, lat, ...(window.__ta.probe(lon, lat) ?? {}) })),
      pts,
    );
    // 双层同经纬度数值对照：y 为顶点实际世界坐标高度，dy = 亚洲层 - 世界层
    const layerPts = [[102, 33], [100, 35], [95, 30], [90, 28], [108, 36], [116, 40], [105, 25], [30, 45]];
    result.layerProbes = await page.evaluate(
      (pts) => pts.map(([lon, lat]) => ({ lon, lat, ...(window.__ta.probeLayers(lon, lat) ?? {}) })),
      layerPts,
    );

    // 固定机位：记录设定后与稳定后的相机，若发生漂移必须如实记录
    for (const v of VIEWS) {
      const set = await page.evaluate(
        (v) => window.__ta.camAt(v.lon, v.lat, v.dist, v.az, v.elev),
        v,
      );
      const immediate = await page.evaluate(() => window.__ta.cam());
      await waitFrames(page);
      const stable = await page.evaluate(() => window.__ta.cam());
      const file = `view-${v.id}.png`;
      const hash = await shot(page, path.join(outDir, file));
      result.views.push({ ...v, setPose: set, camImmediate: immediate, camStable: stable,
        info: await page.evaluate(() => window.__ta.info()), file, sha12: hash });
    }

    // 回到问题机位（hengduan-25），逐项隔离；每项都拍图并恢复
    await page.evaluate(
      (v) => window.__ta.camAt(v.lon, v.lat, v.dist, v.az, v.elev),
      VIEWS[1],
    );
    await waitFrames(page);
    for (const v of VARIANTS) {
      const applied = await page.evaluate((v) => {
        const ta = window.__ta;
        const u = ta.uniforms();
        const nWorld = ta.layer('world-terrain', v.world);
        const nAsia = ta.layer('asia-terrain', v.asia);
        if (u) {
          u.uAOAmt.value = v.ao ? 1 : 0;
          u.uShadowOn.value = v.shadow ? 1 : 0;
        }
        return { nWorld, nAsia };
      }, v);
      await waitFrames(page);
      const cam = await page.evaluate(() => window.__ta.cam());
      const file = `variant-${v.id}.png`;
      const hash = await shot(page, path.join(outDir, file));
      result.variants.push({ ...v, ...applied, cam, file, sha12: hash });
    }
  } catch (e) {
    result.failure = `${e.name}: ${e.message}`;
  } finally {
    if (browser) await browser.close();
    server.close();
    fs.writeFileSync(path.join(outDir, 'baseline.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      outDir,
      mode: result.environment.mode,
      ready: result.ready,
      failure: result.failure,
      errors: result.errors.length,
      variants: result.variants.length,
      renderer: result.browser && result.browser.renderer,
    }, null, 2));
    if (result.failure || !result.ready) process.exitCode = 1;
  }
})();
