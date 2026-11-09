# scripts

开发辅助脚本。除 `verify`（CI 门禁）外都不参与构建，浏览器类脚本只在本机跑。

| 脚本 | 用途 | 入口 |
|---|---|---|
| `py.js` | Python 解释器包装，`npm run` 里的数据管线都经它调用，可用 `PYTHON` 环境变量指定解释器 | — |
| `check-render.js` | 起本地静态服务 → 无头打开 `dist/` → 收 `pageerror`/404 → 断言标注零重叠 → 截图 | `npm run check` |
| `check-func.js` | 功能回归：点选省份、平面↔地球、图层开关、夸张滑块拉满、导览步进 | `npm run check:func` |
| `capture-shots.js` | 重拍 `docs/img/` 的四张文档配图（封面 / 中国 / 喜马拉雅 / 地球） | `npm run shots` |
| `shot.js` | 拍单张指定机位（经纬度 + 距离 + 方位/俯角），调参对比用；第 8 个参数 `globe` 拍地球模式 | `npm run shot` |
| `lib/artifacts.js` | 产物定位：`resolveDist()` 确认 `dist/index.html` 存在 | — |
| `lib/serve.js` | 共用的静态服务 + 浏览器启动参数（本机 Edge + swiftshader 软件渲染） | — |

浏览器脚本靠 `playwright-core` 驱动**本机已安装的浏览器**（不下载 Chromium），路径与启动参数集中在 `lib/serve.js` 的 `LAUNCH`，换机器只改那一处。

```bash
npm run check                     # 渲染校验，截到 check.png
npm run check:func                # 功能回归（会写 shots/func-*.png）
npm run shots                     # 重拍 docs/img/*.png
node scripts/shot.js shots/a.png 88 32 45 0.5 25        # 青藏高原中景
node scripts/shot.js shots/g.png 0 0 0 0 0 globe         # 地球模式
node scripts/check-render.js dist check.png              # 显式指定 dist 目录与输出
```

## 两条硬规矩

1. **不要用固定 `sleep` 等画面就绪**。软件渲染下首帧要编译一整轮地形着色器，wall clock 能差好几秒。统一用 `waitForFunction` 等状态：`window.__ta.info().revealed === true`（开场动画结束）、`info().mix`（模式过渡到位）。
2. **受控输入不要直接赋 `.value`**。React 的 value tracker 会认为值没变、不触发 `onChange`；必须用 `HTMLInputElement.prototype` 上的原生 setter 再派发 `input`。`check-func.js` 里拉夸张滑块那段就是范本。

## 多个 Python 共存时

`npm run build` 默认调 `python`，若该解释器没装 numpy，用 `PYTHON` 指定：

```bash
PYTHON=D:/Apps/python3.11.9/python.exe npm run build
```

`legacy/` 里是 v3/v4 时期的截图脚本，对应当时的 DOM 与图层结构，现在已经跑不通，只作历史参考。
