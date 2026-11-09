# -*- coding: utf-8 -*-
"""生成单文件 HTML：亚洲三维地形沙盘（中国主体 · 产品原型）

前端源码在 src/web/ 下分两层：
  template.html   外壳：HTML 结构 + CSS + 两个占位符
  js/*.js         按职责拆分的模块，构建时按 JS_FILES 顺序拼接进同一个 module script

拆模块是为了可维护；产物仍然是单文件 HTML —— 部署时只认一个文件，不需要静态服务器配置。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import DATASET_DIR, BUILD_SPLIT_JSON, DIST_DIR, WEB_DIR   # noqa: E402

TEMPLATE = os.path.join(WEB_DIR, "template.html")
JS_DIR = os.path.join(WEB_DIR, "js")
OUT = os.path.join(DIST_DIR, "亚洲三维地形沙盘-产品原型.html")

# 拼接顺序 = 依赖顺序：底层工具在前，装配在最后。
# 新增模块必须登记到这里，否则不会进产物（启动时会因为找不到 TA.xxx 直接报错）。
JS_FILES = [
    "00-core.js",        # 命名空间 / 尺度标定 / 投影换算 / THREE 加载
    "05-static.js",      # 静态地理数据（标注、城市、线路）
    "10-data.js",        # 地形数据解码 / 天空遮蔽 / GPU 纹理
    "20-globe.js",       # 平面 ↔ 球面映射（GLSL + CPU）
    "30-terrain.js",     # 地形几何与材质（含光照、阴影、水面）
    "40-overlays.js",    # 海岸 / 省界 / 地级市 / 十段线 / 岛礁
    "45-flow.js",        # 河流 / 铁路 / 公路 / 阶梯分界
    "50-labels.js",      # CSS2D 标注
    "55-globescene.js",  # 球体 / 经纬网 / 大气 / 星空
    "60-tour.js",        # 导览讲稿与运镜
    "65-viewmode.js",    # 平面 ↔ 地球模式切换
    "70-ui.js",          # DOM 事件绑定
    "99-main.js",        # 装配与主循环
]


def load_scripts():
    parts = []
    for name in JS_FILES:
        path = os.path.join(JS_DIR, name)
        if not os.path.exists(path):
            raise SystemExit(f"缺少前端模块：{path}（检查 JS_FILES 登记）")
        with open(path, encoding="utf-8") as f:
            parts.append(f"/* ===== {name} ===== */\n" + f.read())
    return "\n\n".join(parts)


def main():
    if not os.path.exists(BUILD_SPLIT_JSON):
        raise SystemExit(f"缺少输入 {BUILD_SPLIT_JSON}，请先执行 npm run build（或 npm run mask）")

    data = json.load(open(BUILD_SPLIT_JSON, encoding="utf-8"))
    city_path = os.path.join(DATASET_DIR, "cities.json")
    if os.path.exists(city_path):
        data["cities"] = json.load(open(city_path, encoding="utf-8"))

    html = open(TEMPLATE, encoding="utf-8").read()
    scripts = load_scripts()

    # 先替换脚本再替换数据：数据体积大，且 JSON 里可能出现任何字面量
    html = html.replace("__SCRIPTS__", scripts)
    html = html.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    # 安全断言：内联内容不能提前闭合 script 标签
    if "</script" in scripts:
        raise SystemExit("前端模块中含 </script，会提前闭合 script 标签")
    _data_at = html.index("const DATA")
    _tail = html[_data_at:_data_at + 200]
    if "</script" in _tail:
        raise SystemExit("内嵌数据结构中含 </script，会提前闭合 script 标签")
    if "__SCRIPTS__" in html or "__DATA_JSON__" in html:
        raise SystemExit("占位符未完全替换")

    os.makedirs(DIST_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    total = os.path.getsize(OUT)
    print(f"written: {OUT} {total/1024:.0f} KB")
    print(f"modules: {len(JS_FILES)} 个，脚本 {sum(len(s) for s in [scripts])/1024:.0f} KB")


if __name__ == "__main__":
    main()
