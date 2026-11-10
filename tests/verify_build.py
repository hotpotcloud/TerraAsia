# -*- coding: utf-8 -*-
"""构建产物校验（CI 门禁）。

校验的是 `dist/` 这个**静态站点**（Vite 产物），不是单文件 HTML：
    - index.html：没有内联大数据、没有未替换的占位符、能引用到 assets
    - assets/：JS 分包齐全、单包与总量在合理区间、着色器与形变入口没被摇掉
    - data/：地形/掩膜/世界底图齐全，图片尺寸与 meta 自洽，JSON 里不含 base64

图片一律是无损 WebP（PNG 的有损替代会毁掉 16 位高程编码，这里只能 lossless）。

只做静态断言，不启动浏览器；视觉回归看 scripts/check-render.js 与 check-func.js。
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
ASSETS = os.path.join(DIST, "assets")
DATA = os.path.join(DIST, "data")
INDEX = os.path.join(DIST, "index.html")

# 首屏 HTML 应该是薄壳；数据与图片都在 data/ 下按需加载
INDEX_MAX_KB = 40
# 单个 JS 分包上限（three 目前约 650 KB），总量上限
CHUNK_MAX_KB = 1500
JS_TOTAL_MAX_KB = 2000
DIST_MAX_MB = 12.0

# 数据文件下限：防止「文件在但是空壳」
DATA_MIN_KB = {
    "terrain.webp": 1200,
    "mask.webp": 50,
    "data.json": 300,
    "world.webp": 500,
    "world_mask.webp": 30,
    "world.json": 0.1,
}

# 旧格式不许残留：PNG 与 WebP 并存时前端只会读其中一个，多出来的是死重量
FORBIDDEN_DATA = ("terrain.png", "mask.png", "world.png", "world_mask.png")

# 着色器 / 形变入口必须出现在产物 JS 里（被摇掉就等于功能没了）
JS_MARKERS = [
    ("开场揭示", "uReveal"),
    ("球面形变注入", "morphToGlobe"),
    ("地形投射阴影", "sunShadow"),
    ("天空遮蔽采样", "uAO"),
    ("图幅边缘渐隐", "uEdgeMode"),
    ("球面过渡系数", "uGlobe"),
    # 精细覆盖区地表归属：全球粗底图在此让位，防止两套高程网格共面穿插复发。
    # 抽掉这个标记就等于回到「泡状孤岛 + 灰斑沟谷」的旧行为，门禁必须拦下。
    ("精细覆盖区地表归属", "aOverlay"),
]

# 期望的图片尺寸（gw, gh）：亚洲高精网格与全球粗网格
EXPECT_IMG = {
    "terrain.webp": (1536, 1493),
    "mask.webp": (1536, 1493),
    "world.webp": (1024, 1024),
    "world_mask.webp": (1024, 1024),
}

EXPECT_PROVINCES = 33


def fail(msg):
    print("✗ " + msg)
    sys.exit(1)


def kb(path):
    return os.path.getsize(path) / 1024.0


def img_size(path):
    """只读文件头拿尺寸，不解码像素"""
    try:
        return Image.open(path).size
    except Exception as e:  # noqa: BLE001
        fail("%s 打不开（%s）" % (os.path.basename(path), e))


def check_index():
    if not os.path.isfile(INDEX):
        fail("产物不存在：%s（先跑 npm run build）" % INDEX)
    size_kb = kb(INDEX)
    print("· index.html %.2f KB" % size_kb)
    if size_kb > INDEX_MAX_KB:
        fail(
            "index.html 体积 %.1f KB 超过 %d KB —— 数据或图片又被内联回 HTML 了"
            % (size_kb, INDEX_MAX_KB)
        )

    with open(INDEX, encoding="utf-8") as f:
        body = f.read()

    for ph in ("__DATA_JSON__", "__SCRIPTS__"):
        if ph in body:
            fail("残留未替换的占位符：%s" % ph)
    # 单文件时代那种 data URI 内联必须彻底消失
    if re.search(r'data:image/png;base64,[A-Za-z0-9+/=]{5000,}', body):
        fail("index.html 仍内联了大段 base64 图片")

    if "<title>" not in body or "沙盘" not in body:
        fail("缺少页面标题")
    if 'src="./assets/' not in body:
        fail("index.html 未引用 ./assets/ 下的入口脚本")
    if 'href="./assets/' not in body or ".css" not in body:
        fail("index.html 未引用样式表")
    if "id=\"root\"" not in body and "id='root'" not in body:
        fail("index.html 缺少 #root 挂载点（React 没接上）")
    print("· index.html 无内联大数据、引用相对路径 ✓")


def check_assets():
    if not os.path.isdir(ASSETS):
        fail("缺少 assets/ 目录")
    files = sorted(f for f in os.listdir(ASSETS) if f.endswith((".js", ".css")))
    js = [f for f in files if f.endswith(".js")]
    css = [f for f in files if f.endswith(".css")]
    if len(js) < 3:
        fail("JS 分包只有 %d 个，期望 >= 3（应用 + three + r3f）" % len(js))
    if not css:
        fail("缺少 CSS 产物")

    total_js = 0.0
    for f in js:
        size = kb(os.path.join(ASSETS, f))
        total_js += size
        print("· %s %.1f KB" % (f, size))
        if size > CHUNK_MAX_KB:
            fail("%s 单包 %.0f KB 超过 %d KB 上限" % (f, size, CHUNK_MAX_KB))
    if total_js > JS_TOTAL_MAX_KB:
        fail("JS 总量 %.0f KB 超过 %d KB 上限" % (total_js, JS_TOTAL_MAX_KB))

    blob = ""
    for f in js:
        with open(os.path.join(ASSETS, f), encoding="utf-8", errors="ignore") as fh:
            blob += fh.read()

    for name, needle in JS_MARKERS:
        if needle not in blob:
            fail("产物 JS 缺少%s（%s）—— 多半是被 tree-shaking 摇掉了" % (name, needle))
        print("· %s ✓" % name)

    # 开发期标记不该进产物
    for bad in ("__DATA_JSON__", "console.log('DEV"):
        if bad in blob:
            fail("产物 JS 残留开发期标记：%s" % bad)


def check_data():
    if not os.path.isdir(DATA):
        fail("缺少 data/ 目录（地形与矢量数据没有拷进产物）")

    for name, min_kb in DATA_MIN_KB.items():
        p = os.path.join(DATA, name)
        if not os.path.isfile(p):
            fail("缺少数据文件：data/%s" % name)
        size = kb(p)
        if size < min_kb:
            fail("data/%s 只有 %.1f KB，低于 %.1f KB 下限（可能是空壳）" % (name, size, min_kb))
        print("· data/%s %.1f KB" % (name, size))

    for name in FORBIDDEN_DATA:
        if os.path.isfile(os.path.join(DATA, name)):
            fail("data/%s 是旧格式残留，应删掉（现在只发无损 WebP）" % name)

    # 图片尺寸与 meta 自洽：错位会让地形整体偏移或拉伸
    for name, expect in EXPECT_IMG.items():
        got = img_size(os.path.join(DATA, name))
        if tuple(got) != expect:
            fail("data/%s 尺寸 %dx%d，期望 %dx%d" % (name, got[0], got[1], expect[0], expect[1]))
    print("· 图片尺寸与预期一致 ✓")

    with open(os.path.join(DATA, "world.json"), encoding="utf-8") as f:
        world = json.load(f)
    if world.get("gw") != EXPECT_IMG["world.webp"][0] or world.get("gh") != EXPECT_IMG["world.webp"][1]:
        fail("world.json 的 gw/gh 与 world.webp 尺寸不一致")
    if world.get("lon1", 0) <= world.get("lon0", 0):
        fail("world.json 经度范围非法")
    print("· world.json 与底图尺寸自洽 ✓")

    p = os.path.join(DATA, "data.json")
    with open(p, encoding="utf-8") as f:
        raw = f.read()
    if "iVBORw0KGgo" in raw:
        fail("data.json 里仍有 base64 图片 —— 图片应拆成独立文件")

    doc = json.loads(raw)
    meta = doc.get("meta") or {}
    for k in ("lon0", "lon1", "lat0", "lat1", "gw", "gh", "min_elev", "max_elev"):
        if k not in meta:
            fail("data.json 的 meta 缺少字段 %s" % k)
    if (meta["gw"], meta["gh"]) != EXPECT_IMG["terrain.webp"]:
        fail("data.json 的 gw/gh 与 terrain.webp 尺寸不一致")

    provs = doc.get("provinces") or []
    if len(provs) != EXPECT_PROVINCES:
        fail("省份数 %d，期望 %d（行政区划数据不完整）" % (len(provs), EXPECT_PROVINCES))
    if not all(p.get("rings") for p in provs):
        fail("存在没有环的省份记录，点选会失效")
    for key in ("coast", "rivers", "tierlines", "markers", "cities"):
        if not doc.get(key):
            fail("data.json 缺少矢量图层：%s" % key)
    print("· 省份 %d / 城市 %d / 图层齐全 ✓" % (len(provs), len(doc.get("cities") or [])))


def check_total():
    total = 0
    for root, _dirs, files in os.walk(DIST):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    mb = total / 1024 / 1024
    print("· dist/ 合计 %.2f MB" % mb)
    if mb > DIST_MAX_MB:
        fail("dist/ 合计 %.2f MB 超过 %.1f MB 上限" % (mb, DIST_MAX_MB))


def main():
    print("TerraAsia 产物校验 · %s\n" % DIST)
    check_index()
    print()
    check_assets()
    print()
    check_data()
    print()
    check_total()
    print("\n✓ 产物校验通过（index.html + assets + data 齐全）")


if __name__ == "__main__":
    main()
