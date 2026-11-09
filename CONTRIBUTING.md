# 参与开发

## 环境

| 需要 | 版本 | 说明 |
|---|---|---|
| Python | 3.9+ | 需要 numpy / Pillow / requests，`pip install -r requirements.txt` |
| Node.js | 18+ | 仅开发依赖（playwright-core）；运行时不需要 Node |
| 浏览器 | Edge / Chrome | `npm run check` 会用本机浏览器做无头渲染 |

```bash
npm install
pip install -r requirements.txt
npm run build     # 首次会下载 1012 张 DEM 瓦片（亚洲 z6 + 全球 z4），约 55MB，之后走本地缓存
```

本机有多个 Python 时，`python` 未必是装了 numpy 的那个，用 `PYTHON` 指定解释器：

```bash
PYTHON=D:/Apps/python3.11.9/python.exe npm run build
```

`npm run build` 可重复执行且结果一致（同一份输入 → 同一份产物）。若产物出现「海洋被染成土黄、阶梯配色消失」，先看 `build/data.split.json` 的 `maskPng` 是不是只有几 KB。

## 开工前先读

1. [docs/02-开发规范](docs/02-开发规范.md) —— 目录职责、命名、代码风格、数据边界
2. [docs/01-产品说明](docs/01-产品说明.md) —— 「视觉与数据方案」一节解释了绝大多数"为什么这样写"

## 分支与提交

```bash
git checkout -b feat/省域下钻
# ...改代码...
npm run build && npm run verify && npm run check && npm run check:func
git commit -m "feat: 支持省域 DEM 高精度块载入"
```

- 提交信息用 Conventional Commits，subject 用中文；类型：`feat` `fix` `docs` `refactor` `chore` `perf`
- 一个提交只做一件事，重构与功能分开
- `main` 受保护，改动走 PR；推 `main` 会直接触发线上部署

## 不要提交

`dist/` `build/` `data/cache/` `node_modules/` 均已在 `.gitignore` 中。产物是构建出来的，手改会在下次构建时被覆盖。

## 数据改动

- 换权威数据（国界、水系、交通）时，在 PR 描述里写清**来源、坐标系、审图号（若适用）」**
- `data/cache/` 里的东西可以直接删，会自动重新下载
- `data/datasets/cities.json` 入库是为了避免每次重抓；改行政区划数据后跑 `npm run cities` 并说明原因
