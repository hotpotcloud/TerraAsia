# src/web

前端源码分两层，构建时拼成一个单文件 HTML：

```
src/web/
├── template.html     外壳：HTML 结构 + CSS + 两个占位符（__DATA_JSON__ / __SCRIPTS__）
└── js/               按职责拆分的模块，按 JS_FILES 顺序拼接
    ├── 00-core.js          命名空间 / 尺度标定 / 投影换算 / THREE 加载
    ├── 05-static.js        静态地理数据（标注、城市、线路）
    ├── 10-data.js          地形数据解码 / 天空遮蔽 / GPU 纹理
    ├── 20-globe.js         平面 ↔ 球面映射（GLSL + CPU 两版）
    ├── 30-terrain.js       地形几何与材质（光照、投射阴影、水面）
    ├── 40-overlays.js      海岸 / 省界 / 地级市 / 十段线 / 岛礁
    ├── 45-flow.js          河流 / 铁路 / 公路 / 阶梯分界
    ├── 50-labels.js        CSS2D 标注与 LOD
    ├── 55-globescene.js    球体 / 经纬网 / 大气 / 星空
    ├── 60-tour.js          导览讲稿与运镜
    ├── 65-viewmode.js      平面 ↔ 地球模式切换
    ├── 70-ui.js            DOM 事件绑定
    └── 99-main.js          装配与主循环
```

## 模块约定

- **每个文件是一个 IIFE**，向 `window.TA` 挂一个命名空间：`TA.core`、`TA.terrain`……
  不用 `import/export` 是为了让构建脚本能按顺序直接拼接（产物必须是单文件）。
- **依赖靠 `create(ctx)` 注入**，不读全局：`ctx` 里放 `T / proj / data / globe / scene / DATA` 等。
  模块之间只调用对方的公开方法，不碰内部变量。
- **新增模块必须登记到 `src/pipeline/build_html.py` 的 `JS_FILES`**，
  漏登记不会报错，只会在运行时因为 `TA.xxx` 未定义而白屏——`tests/verify_build.py` 会拦住。
- **只在主循环里调度**：`99-main.js` 的 `animate()` 只负责调用各模块的 `update/tick`，
  不写任何具体的渲染或交互逻辑。

## 为什么产物还是单文件

双击即开、方便发给别人、可以塞进课件；部署时只认一个文件，不需要额外配置静态服务。

## 改这里的注意事项

- 不引入外部 JS/CSS 依赖；Three.js 走 CDN（三源回退：jsdelivr → unpkg → esm.sh）
- 不引入图片资源，所有视觉都靠程序生成；产物每涨 1MB，加载体验就掉一档
- 自定义 ShaderMaterial 的颜色常量按**线性值**写（屏幕色会经 sRGB 输出转换），
  需要"屏幕色等于设计稿 hex"时用 `TA.core.rawColor()`
- 新增图层或标注时，同步加开关与 LOD 分级，并确认 `camD` 阈值下的显隐行为
- `20-globe.js` 里的 GLSL 与 JS 是**同一套映射的两份实现**，改动必须同步，
  否则球面模式下标注会和地形错位
