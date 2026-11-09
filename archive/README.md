# archive —— 历史实现留档

只读参考，**不参与构建**，不进 CI，不被任何脚本引用。

## `v0.6-web/` 单文件时代的全部前端

v0.6 的交付物是一个 4.3 MB 的单文件 HTML：数据、着色器、13 个 JS 模块在构建时全部拼进
`dist/亚洲三维地形沙盘-产品原型.html`，双击即可打开（Three.js 走 CDN）。

```
v0.6-web/
├── template.html     外壳：HTML 结构 + CSS + __DATA_JSON__ / __SCRIPTS__ 占位符
├── js/               13 个按序号拼接的模块（00-core … 99-main），靠全局作用域互相访问
└── build_html.py     把 template + data + js 拼成单文件；JS_FILES 就是拼接顺序表
```

v0.7 换成 Vite + React + TypeScript 后，这些代码的去向：

| v0.6 | v0.7 |
|---|---|
| `js/00-core.js` | `app/src/data/globe.ts` + `app/src/scene/viewState.ts` |
| `js/05-static.js`、`js/10-data.js` | `app/src/data/static.ts`、`app/src/data/terrainLoader.ts`（数据改为 `app/public/data/` 静态资源） |
| `js/20-globe.js`、`js/30-terrain.js` | `app/src/scene/terrainMaterial.ts`、`terrainGeometry.ts`、`TerrainMesh.tsx` |
| `js/40-overlays.js`、`js/45-flow.js` | `app/src/scene/VectorLayers.tsx`、`FlowLayers.tsx`、`GlobeDecor.tsx` |
| `js/50-labels.js` | `app/src/scene/LabelLayer.tsx`（新增屏幕空间避让） |
| `js/55-globescene.js`、`js/65-viewmode.js` | `app/src/scene/SceneBridge.tsx` |
| `js/60-tour.js` | `app/src/data/tour.ts` |
| `js/70-ui.js` | `app/src/ui/SidePanel.tsx`、`Chrome.tsx` |
| `build_html.py` | 拆成 `publish_data.py`（出静态数据）+ `vite build`（出站点） |

留给后来人：这段代码是「逻辑怎么算」的第一版答案（AO 预计算、地平线扫描阴影、球面映射），
对着看比读 v0.7 的 TypeScript 更快。**不要**在这上面继续开发。
