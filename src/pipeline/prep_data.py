# -*- coding: utf-8 -*-
"""
亚洲三维地形原型 · 数据准备脚本
1. 下载 Terrarium DEM 瓦片 (z6) 拼成 亚洲范围 高度场
2. 用标准中国边界(含台湾/南海诸岛)栅格化陆地掩膜(带海岸羽化)
3. 手工三级阶梯分区多边形 → 逐像素阶梯归属
4. 边界/省界/十段线/河流/阶梯分界线 → 抽稀后的 JSON
5. 高度+掩膜+阶梯+水深 编码进单张 RGBA PNG
输出: data.json
"""
import os, io, json, math, base64, time
import concurrent.futures as cf
import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import SOURCE_DIR, CACHE_DIR, BUILD_DIR, BUILD_JSON   # noqa: E402
UA = {"User-Agent": "WorkBuddyGeoPrototype/1.0 (eason)"}

ZOOM = 6
# 亚洲范围: 西起土耳其/东地中海(25°E), 东到白令海峡(180°), 南到印尼(-11°), 北到北冰洋(80°)
LON0, LON1 = 25.0, 180.0
LAT0, LAT1 = -11.0, 80.0
GW = 1536                      # 输出网格宽(像素); GH 按墨卡托比例自动算

# ---------- 工具 ----------
def merc_norm(lat):
    return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2

def lon_to_px(lon, P):
    return (lon + 180) / 360 * P

def lat_to_px(lat, P):
    return merc_norm(lat) * P

def rdp(pts, tol):
    """Douglas-Peucker 抽稀, pts=[(x,y),...]"""
    if len(pts) < 3:
        return pts
    def pd(p, a, b):
        ax, ay = a; bx, by = b; px, py = p
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        if L == 0:
            return math.hypot(px - ax, py - ay)
        return abs(dy * px - dx * py + bx * ay - by * ax) / L
    d = [pd(p, pts[0], pts[-1]) for p in pts]
    i = int(np.argmax(d))
    if d[i] > tol:
        return rdp(pts[:i + 1], tol)[:-1] + rdp(pts[i:], tol)
    return [pts[0], pts[-1]]

def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]; x2, y2 = ring[i + 1]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2

# ---------- 1. 下载 DEM 瓦片 ----------
n = 1 << ZOOM
x0 = max(0, min(n - 1, int((LON0 + 180) / 360 * n)))
x1 = max(0, min(n - 1, int((LON1 + 180) / 360 * n)))
y0 = max(0, min(n - 1, int(merc_norm(LAT1) * n)))
y1 = max(0, min(n - 1, int(merc_norm(LAT0) * n)))
P = n * 256
tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
print(f"tiles z{ZOOM}: x{x0}-{x1} y{y0}-{y1} = {len(tiles)}")

def fetch(x, y, tries=3):
    """带本地缓存: 瓦片落到 data/tiles/, 重复运行不再下载"""
    cache_dir = os.path.join(CACHE_DIR, "tiles")
    os.makedirs(cache_dir, exist_ok=True)
    fp = os.path.join(cache_dir, f"{ZOOM}_{x}_{y}.png")
    if os.path.exists(fp):
        with open(fp, "rb") as fh:
            return x, y, fh.read()
    for t in range(tries):
        try:
            r = requests.get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png",
                             headers=UA, timeout=30)
            if r.status_code == 200:
                with open(fp, "wb") as fh:
                    fh.write(r.content)
                return x, y, r.content
            if r.status_code == 404:
                return x, y, None
        except Exception:
            time.sleep(1 + t)
    return x, y, None

tw, th = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
print(f"mosaic {tw}x{th} = {tw*th/1e6:.1f} Mpx")
mosaic = np.zeros((th, tw), dtype=np.int16)   # int16 存高程, 省一半内存
tx_off, ty_off = x0 * 256, y0 * 256
ok_cnt = 0
with cf.ThreadPoolExecutor(16) as ex:
    for x, y, content in ex.map(lambda t: fetch(*t), tiles):
        if content:
            img = np.asarray(Image.open(io.BytesIO(content)).convert("RGB"), dtype=np.float32)
            elev = img[..., 0] * 256 + img[..., 1] + img[..., 2] / 256 - 32768
            mosaic[y * 256 - ty_off:(y + 1) * 256 - ty_off,
                   x * 256 - tx_off:(x + 1) * 256 - tx_off] = np.round(elev).astype(np.int16)
            ok_cnt += 1
print(f"tiles ok: {ok_cnt}/{len(tiles)}")

# ---------- 2. 裁剪到 bbox 并降采样(按行分带, 避免一次性 float 化占满内存) ----------
cx0, cy0 = lon_to_px(LON0, P) - tx_off, lat_to_px(LAT1, P) - ty_off
cx1, cy1 = lon_to_px(LON1, P) - tx_off, lat_to_px(LAT0, P) - ty_off
cw, ch = int(round(cx1 - cx0)), int(round(cy1 - cy0))
GH = int(round(GW * ch / cw))
print(f"crop {cw}x{ch} -> grid {GW}x{GH}")
BAND = 1024
parts, done = [], 0
for by in range(0, ch, BAND):
    bh = min(BAND, ch - by)
    band = mosaic[int(cy0) + by:int(cy0) + by + bh, int(cx0):int(cx0) + cw].astype(np.float32)
    np.clip(band, -11000, 9000, out=band)
    prev = done
    done = int(round((by + bh) * GH / ch))
    th_out = done - prev
    if th_out <= 0:
        continue
    # 面积平均降采样: 双线性会跳过源像素, 在陡崖处产生高/低交替的锯齿
    parts.append(np.asarray(Image.fromarray(band, mode="F").resize((GW, th_out), Image.BOX), dtype=np.float32))
    del band
grid = np.vstack(parts)
del parts, mosaic
print(f"grid {grid.shape[1]}x{grid.shape[0]}  elev[{grid.min():.0f}, {grid.max():.0f}]")

# 网格坐标映射(像素中心): grid x=0 -> LON0, x=GW-1 -> LON1(近似)
def px_of(lon, lat, W, H):
    x = (lon_to_px(lon, P) - tx_off - cx0) / cw * W
    y = (lat_to_px(lat, P) - ty_off - cy0) / ch * H
    return x, y

# ---------- 3. 陆地掩膜(2x 分辨率栅格化 + 羽化降采样) ----------
bound = json.load(open(os.path.join(SOURCE_DIR, "china_bound.json"), encoding="utf-8"))
geom = bound["features"][0]["geometry"]
polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]

MW, MH = GW * 2, GH * 2
mask_img = Image.new("L", (MW, MH), 0)
dr = ImageDraw.Draw(mask_img)
line_polys, marker_pts = [], []
for poly in polys:
    outer = poly[0]
    a = ring_area(outer)
    if a >= 0.004:  # 画海岸线的大 polygon
        line_polys.append(outer)
        pts = [px_of(x, y, MW, MH) for x, y in outer]
        dr.polygon(pts, fill=255)
    else:
        cx = sum(p[0] for p in outer) / len(outer)
        cy = sum(p[1] for p in outer) / len(outer)
        marker_pts.append((round(cx, 3), round(cy, 3), round(a, 5)))
china_mask = np.asarray(mask_img.resize((GW, GH), Image.BOX), dtype=np.float32) / 255.0
print(f"china mask: land_px={(china_mask>=0.5).sum()}")
print(f"coast lines: {len(line_polys)}, island markers: {len(marker_pts)}")

# 整个亚洲的陆地: Terrarium 带海底地形(海为负), 高程>0 即陆地; 中国境内用精确边界兜底
land_dem = (grid > 0.5).astype(np.float32)
mask = np.maximum(china_mask, land_dem)
# 海岸羽化(仅视觉过渡), 半径 0.8px
mask = np.asarray(Image.fromarray(np.round(mask * 255).astype(np.uint8)).filter(
    ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255.0
cn_land = china_mask >= 0.5
print(f"asia land: {(mask>=0.5).sum()} px / {GW*GH} ({100.0*(mask>=0.5).sum()/(GW*GH):.1f}%)")

# ---------- 4. 三级阶梯分区 ----------
T1_POLY = [  # 第一阶梯·青藏高原(昆仑-阿尔金-祁连-横断一线以南以西)
    [73.6,39.4],[75.8,38.5],[77.5,36.8],[80.5,36.2],[83.5,35.9],[86.5,36.2],[89.5,37.3],
    [92.0,38.9],[93.8,39.6],[96.5,39.8],[99.5,39.4],[101.8,38.7],[103.3,37.6],[103.1,34.8],
    [102.7,32.0],[102.3,29.5],[101.7,27.2],[100.6,25.2],[98.8,24.2],[97.6,23.9],[97.4,26.0],
    [96.4,28.9],[94.6,29.2],[92.0,27.9],[88.9,27.4],[85.8,28.3],[81.0,30.2],[78.0,32.5],
    [75.8,35.5],[74.3,37.0],[73.6,38.6],
]
T3_POLY = [  # 第三阶梯·大兴安岭-太行-巫山-雪峰山以东(含东北平原/华北平原/长江中下游平原/东南丘陵)
    [121.8,53.3],[122.3,51.0],[121.0,49.3],[120.0,47.6],[119.3,46.0],[118.4,44.4],[117.6,43.2],
    [117.0,42.3],[115.8,40.6],[114.5,38.9],[113.6,37.0],[112.8,35.6],[111.3,33.0],[110.6,31.3],
    [110.0,29.7],[110.2,28.3],[109.9,26.7],[108.8,25.6],[107.0,23.9],[105.8,22.9],[106.7,22.1],
    [108.0,21.6],[109.6,21.4],[110.4,20.2],[109.6,21.4],[110.8,21.4],[113.0,21.9],[113.7,22.4],
    [116.5,23.3],[119.8,25.8],[121.6,28.2],[121.9,30.9],[121.0,32.5],[119.9,34.5],[120.9,36.4],
    [122.5,37.0],[119.9,37.8],[118.0,39.2],[121.2,40.9],[123.5,39.8],[125.4,41.0],[126.9,41.8],
    [128.1,42.0],[129.8,42.5],[130.7,42.7],[133.1,44.0],[134.7,47.7],[134.8,48.4],[127.6,50.3],
    [124.5,53.0],
]
ISLAND_T3 = {  # 岛屿阶梯归属(第三阶梯)
    "hainan": (108.6, 111.1, 18.1, 20.2),
    "taiwan": (119.8, 122.1, 21.8, 25.4),
}

def raster_poly(poly, val=255):
    im = Image.new("L", (MW, MH), 0)
    d = ImageDraw.Draw(im)
    d.polygon([px_of(x, y, MW, MH) for x, y in poly], fill=val)
    return np.asarray(im.resize((GW, GH), Image.BOX), dtype=np.float32) / 255.0

t1m = raster_poly(T1_POLY)
t3m = raster_poly(T3_POLY)
for lo0, lo1, la0, la1 in ISLAND_T3.values():
    lon_g = LON0 + (np.arange(GW) + 0.5) / GW * (LON1 - LON0)
    lat_g = LAT1 - (np.arange(GH) + 0.5) / GH * (LAT1 - LAT0)
    inb = ((lat_g >= la0) & (lat_g <= la1))[:, None] & ((lon_g >= lo0) & (lon_g <= lo1))[None, :]
    t3m = np.maximum(t3m, np.where(inb, 1.0, 0.0).astype(np.float32))

tier = np.full((GH, GW), 2, dtype=np.uint8)
tier[(t1m >= 0.5)] = 1
tier[(t3m >= 0.5)] = 3
tier[~cn_land] = 0          # 境外陆地: 0 → 前端映射为 4(不参与阶梯压暗)
print("tier stats (中国陆地):", {int(k): int(v) for k, v in zip(*np.unique(tier[cn_land], return_counts=True))})

# ---------- 5. 水深: 用 Terrarium 自带海底地形(负高程) ----------
depth = np.clip(-grid / 6000.0, 0.0, 1.0)
depth[cn_land] = 0.0

# ---------- 6. 编码 RGBA PNG ----------
elev_code = np.clip(np.round(grid + 300), 0, 65535).astype(np.uint16)
Rc = (elev_code >> 8).astype(np.uint8)
Gc = (elev_code & 0xFF).astype(np.uint8)
Ac = np.round(mask * 255).astype(np.uint8)
Bc = np.zeros((GH, GW), dtype=np.uint8)
Bc[cn_land] = (tier[cn_land] * 85).astype(np.uint8)
Bc[~cn_land] = np.round(depth[~cn_land] * 255).astype(np.uint8)
rgba = np.dstack([Rc, Gc, Bc, Ac])
png = Image.fromarray(rgba, mode="RGBA")
buf = io.BytesIO()
png.save(buf, format="PNG", optimize=True)
png_b64 = base64.b64encode(buf.getvalue()).decode()
print(f"terrain png: {len(buf.getvalue())/1024:.0f} KB")

# ---------- 7. 海岸线 / 岛屿点 / 省界 / 十段线 ----------
coast = []
def _area2(pts):
    return abs(sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1))) / 2
for ring in line_polys:
    pts = rdp([(x, y) for x, y in ring], 0.03)
    # 抽稀后退化成 3 点/细长条的小岛 → 转为点标记(否则会在海面画出狭长斜线)
    _xs = [p[0] for p in pts]; _ys = [p[1] for p in pts]
    _w = max(_xs) - min(_xs); _h = max(_ys) - min(_ys)
    _compact = _area2(pts) / max(_w * _h, 1e-9)
    # 抽稀后退化成 3 点 / 面积过小 / 过狭长(岛群环跨岛连线) → 一律转为点标记
    if len(pts) < 4 or _area2(pts) < 0.012 or _compact < 0.05 or max(_w, _h) > 2.2:
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        marker_pts.append((round(cx, 3), round(cy, 3), round(_area2(pts), 5)))
        continue
    coast.append([[round(x, 3), round(y, 3)] for x, y in pts])
coast.sort(key=lambda r: -len(r))
coast = coast[:60]  # 取前60条(按长度), 小岛已转为点标记

marker_pts.sort(key=lambda t: -t[2])
markers = [[x, y] for x, y, _ in marker_pts[:260]]

full = json.load(open(os.path.join(SOURCE_DIR, "china_bound_full.json"), encoding="utf-8"))
provinces = []
for f in full["features"]:
    g = f["geometry"]
    nm = f.get("properties", {}).get("name")
    if not nm:
        continue
    polys2 = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    rings = []
    for poly in polys2:
        ring = poly[0]                       # 只取外环(跳过内洞/飞地内洞)
        if ring_area(ring) < 0.005:
            continue
        pts = rdp([(x, y) for x, y in ring], 0.05)
        if len(pts) < 3:
            continue
        rings.append([[round(x, 2), round(y, 2)] for x, y in pts])
    if not rings:
        continue
    # 该省平均海拔 / 主体阶梯(供点击信息卡使用)
    im2 = Image.new("L", (GW, GH), 0)
    d2 = ImageDraw.Draw(im2)
    for r in rings:
        d2.polygon([px_of(x, y, GW, GH) for x, y in r], fill=255)
    arr = np.asarray(im2) > 127
    if arr.any():
        avg = float(grid[arr].mean())
        tt = tier[arr]
        main_tier = int(np.bincount(tt).argmax())
    else:
        avg, main_tier = 0.0, 2
    provinces.append({"name": nm, "rings": rings, "avg": int(round(avg)), "tier": main_tier})
print(f"provinces: {len(provinces)}, rings total: {sum(len(p['rings']) for p in provinces)}")

dash = []
seg = []
for line in open(os.path.join(SOURCE_DIR, "ten-dash-line.gmt"), encoding="utf-8"):
    line = line.strip()
    if line.startswith(">"):
        if seg:
            dash.append(seg); seg = []
    elif line and not line.startswith("#"):
        p = line.split()
        if len(p) >= 2:
            seg.append([round(float(p[0]), 4), round(float(p[1]), 4)])
if seg:
    dash.append(seg)
print(f"dash segments: {len(dash)}")

# ---------- 8. 河流(手绘干流节点) ----------
rivers = {
    "长江": [[[90.7,33.5],[92.5,33.2],[94.5,32.8],[96.5,32.4],[97.8,31.3],[98.7,29.5],[99.3,27.6],
              [99.8,26.6],[100.6,26.0],[101.3,26.9],[101.9,28.2],[102.6,29.2],[103.4,28.7],[104.6,28.8],
              [105.4,28.9],[106.3,29.5],[107.2,30.3],[108.4,30.4],[109.5,30.5],[110.6,30.6],[111.3,30.7],
              [112.0,30.4],[112.9,29.7],[113.7,30.2],[114.6,30.5],[115.5,29.9],[116.5,29.8],[117.5,30.4],
              [118.6,31.8],[119.5,32.4],[120.7,32.0],[121.7,31.5],[122.2,31.4]]],
    "黄河": [[[96.4,35.0],[97.8,35.2],[99.4,35.6],[100.8,35.6],[101.8,35.9],[103.0,35.9],[103.8,36.1],
              [104.7,36.5],[105.4,37.4],[106.2,38.2],[106.9,39.3],[107.0,40.4],[108.2,40.7],[109.8,40.5],
              [111.1,40.3],[111.2,39.3],[110.7,38.3],[110.5,37.2],[110.4,36.1],[110.3,34.9],[111.2,34.8],
              [112.4,34.8],[113.6,34.9],[114.6,34.8],[115.5,35.5],[116.5,36.0],[117.4,36.7],[118.3,37.2],
              [119.1,37.8]]],
    "珠江": [[[102.8,24.4],[104.0,24.6],[105.4,24.6],[106.2,24.1],[106.8,23.7],[107.9,23.2],[108.7,22.8],
              [109.9,23.0],[110.8,23.4],[111.6,23.5],[112.5,23.2],[113.1,23.1],[113.6,23.1]]],
    "黑龙江": [[[119.8,50.2],[121.5,50.5],[123.0,50.8],[124.3,52.5],[125.5,53.0],[126.5,52.8],[127.5,51.3],
                [128.0,50.3],[129.0,49.6],[130.5,48.9],[132.0,47.9],[133.5,48.1],[134.3,48.3]]],
    "松花江": [
        [[124.4,49.3],[125.2,47.8],[125.8,46.3],[125.6,45.4],[126.6,45.8],[127.6,46.0],[128.8,46.3],
         [130.3,46.8],[132.0,47.5],[132.5,47.9]],
        [[127.5,42.0],[126.9,43.2],[126.5,43.7],[126.0,44.5],[125.6,45.3]]],
    "雅鲁藏布江": [[[82.0,30.5],[83.5,30.0],[85.0,29.5],[86.5,29.2],[88.2,29.1],[89.6,29.2],[91.0,29.2],
                  [92.4,29.1],[93.6,29.1],[94.7,29.3],[95.1,29.2],[95.3,28.6],[95.5,28.0],[96.0,27.6]]],
    "塔里木河": [[[80.8,41.15],[82.3,41.1],[84.0,41.0],[85.5,40.9],[86.6,40.6],[87.2,40.2],[87.5,39.9]]],
    "淮河": [[[113.4,32.4],[114.5,32.5],[115.8,32.7],[117.0,32.9],[118.2,32.9],[118.8,33.3]]],
    "辽河": [[[119.0,43.5],[120.5,43.0],[121.9,42.9],[122.0,41.9],[121.8,40.9]]],
    "海河": [[[115.0,40.2],[116.0,39.9],[116.9,39.4],[117.2,39.1],[117.8,38.9]]],
}

# ---------- 9. 阶梯分界线(教学标准表述的近似折线) ----------
tierlines = {
    "一二阶梯分界线·昆仑山—阿尔金山—祁连山—横断山": [
        [73.9,39.0],[75.8,38.4],[77.5,36.7],[80.5,36.1],[83.5,35.8],[86.5,36.1],[89.5,37.2],
        [92.0,38.8],[93.8,39.5],[96.5,39.7],[99.5,39.3],[101.8,38.6],[103.2,37.4],[103.0,34.6],
        [102.5,31.8],[102.0,29.2],[101.4,27.0],[100.4,25.0],[98.9,24.1]],
    "二三阶梯分界线·大兴安岭—太行山—巫山—雪峰山": [
        [122.0,52.8],[121.5,50.8],[120.6,49.2],[119.8,47.5],[119.0,45.9],[118.2,44.3],[117.4,43.0],
        [116.8,42.2],[115.6,40.5],[114.3,38.8],[113.4,36.9],[112.6,35.5],[111.2,32.9],[110.5,31.2],
        [109.9,29.6],[110.1,28.2],[109.8,26.6],[109.4,25.2]],
}

meta = {
    "lon0": LON0, "lon1": LON1, "lat0": LAT0, "lat1": LAT1,
    "gw": GW, "gh": GH,
    "min_elev": float(grid[mask >= 0.5].min()) if (mask >= 0.5).any() else 0,
    "max_elev": float(grid[mask >= 0.5].max()) if (mask >= 0.5).any() else 0,
    # 前端经纬度 → 纹理像素 换算所需(与本次裁剪一致, 重跑后自动同步)
    "map": {"P": P, "txOff": tx_off, "tyOff": ty_off, "cx0": cx0, "cy0": cy0, "cw": cw, "ch": ch},
}

out = {
    "meta": meta,
    "png": png_b64,
    "coast": coast,
    "markers": markers,
    "provinces": provinces,
    "dash": dash,
    "rivers": rivers,
    "tierlines": tierlines,
}
os.makedirs(BUILD_DIR, exist_ok=True)
with open(BUILD_JSON, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"data.json: {os.path.getsize(BUILD_JSON)/1024:.0f} KB")
print("meta:", meta)
