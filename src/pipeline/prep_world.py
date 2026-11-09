# -*- coding: utf-8 -*-
"""全球粗底图: 拼 Terrarium z4 (16×16 瓦片) → 1024×1024 全球高度场 + 陆地掩膜

为什么单独一张:
    亚洲窗口用的是 z6 高精网格 (11 km/格), 只覆盖东经 25°–180°。球面模式下其余
    球面本来是空的, 靠一层暗球补 —— 看起来像"半个地球"。这张全球底图把整颗星球
    铺满, 亚洲高精网格再压在它上面, 于是两级精度共存:
        底图  1024×1024  约 39 km/格   铺满 ±85.05°
        亚洲  1536×1493  约 11 km/格   只覆盖亚洲窗口

编码与 prep_data 完全一致 (前端只有一套解码):
    R,G = 16 位高程 (米 + 300 偏移)
    B   = 水深 depth*255 (陆地写 0 → 前端自动落进"境外陆地"分支)
    掩膜拆到独立 webp

输出 app/public/data/world.webp / world_mask.webp / world.json
（无损 WebP 而非 PNG：同样的像素，体积小约 30%。有损会破坏 16 位高程编码，
  26% 的像素会在"境内/境外"判定上翻转，所以这里必须 lossless）
"""
import io
import json
import os
import sys

import numpy as np
import requests
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import APP_DATA_DIR, CACHE_DIR   # noqa: E402

ZOOM = 4
TILE = 256
GRID = 1024                     # 输出网格边长（正方形，全球墨卡托）
N = 2 ** ZOOM                   # 每边瓦片数
LAT_LIMIT = 85.05112877980659   # 墨卡托标准截断纬度

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png"
CACHE = os.path.join(CACHE_DIR, "world")


def fetch(x, y):
    path = os.path.join(CACHE, f"{ZOOM}_{x}_{y}.png")
    if os.path.exists(path):
        return x, y, open(path, "rb").read()
    r = requests.get(URL % (ZOOM, x, y), timeout=60)
    r.raise_for_status()
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "wb") as f:
        f.write(r.content)
    return x, y, r.content


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(APP_DATA_DIR, exist_ok=True)

    tiles = [(x, y) for x in range(N) for y in range(N)]
    print(f"tiles z{ZOOM}: {len(tiles)} 张")

    elev = np.zeros((N * TILE, N * TILE), dtype=np.float32)
    with ThreadPoolExecutor(max_workers=8) as ex:
        for x, y, content in ex.map(lambda t: fetch(*t), tiles):
            im = np.asarray(Image.open(io.BytesIO(content)).convert("RGB"), dtype=np.float32)
            e = im[..., 0] * 256.0 + im[..., 1] + im[..., 2] / 256.0 - 32768.0
            elev[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE] = e

    print(f"mosaic {elev.shape[1]}x{elev.shape[0]}  elev[{elev.min():.0f}, {elev.max():.0f}]")

    # 缩到目标网格：BOX 平均，避免直接抽样产生锯齿
    img = Image.fromarray(elev, mode="F")
    grid = np.asarray(img.resize((GRID, GRID), Image.BOX), dtype=np.float32)
    # 源瓦片偶有个别尖刺（实测 z4 的 x4/y3 有 2 个像素报到 11500 m）。
    # 只夹异常值，不做整体重标定 —— 真实最高点 8848.86 必须原样保留。
    spikes = int(((grid > 8900) | (grid < -11000)).sum())
    grid = np.clip(grid, -11000.0, 8900.0)
    print(f"grid {GRID}x{GRID}  elev[{grid.min():.0f}, {grid.max():.0f}]  夹掉尖刺 {spikes} 个")

    # 陆地掩膜：以 0 米为界，再轻微模糊掉一格台阶
    land = (grid > 0).astype(np.float32)
    land = np.asarray(
        Image.fromarray((land * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)),
        dtype=np.float32,
    ) / 255.0
    land_ratio = float((land >= 0.5).mean())
    # 注意：球面上陆地只占 29%，但墨卡托会把两极附近按 1/cos(lat) 放大，
    # 南极洲、格陵兰、西伯利亚因此膨胀，图上陆地占比约 40% 才是对的。
    if not (0.32 <= land_ratio <= 0.50):
        raise SystemExit(f"全球陆地占比异常({land_ratio:.1%})，墨卡托图上应约 40% —— 瓦片下载或解码有问题")

    depth = np.clip(-grid / 6000.0, 0.0, 1.0)
    elev_code = np.clip(np.round(grid + 300), 0, 65535).astype(np.uint16)

    # 只要 R/G（16 位高程）与 B（水深），alpha 用不上（掩膜是单独的 world_mask）：
    # 三通道无损 WebP 比四通道 PNG 小约 30%，是这条 3 Mbps 小水管上最直接的收益
    rgb = np.zeros((GRID, GRID, 3), dtype=np.uint8)
    rgb[..., 0] = (elev_code >> 8) & 255
    rgb[..., 1] = elev_code & 255
    rgb[..., 2] = np.round(depth * 255).astype(np.uint8)
    rgb[..., 2][land > 0.5] = 0            # 陆地不写水深

    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="WEBP", lossless=True, quality=100, method=6)
    with open(os.path.join(APP_DATA_DIR, "world.webp"), "wb") as f:
        f.write(buf.getvalue())

    buf2 = io.BytesIO()
    Image.fromarray(np.round(land * 255).astype(np.uint8), "L").save(
        buf2, format="WEBP", lossless=True, quality=100, method=6)
    with open(os.path.join(APP_DATA_DIR, "world_mask.webp"), "wb") as f:
        f.write(buf2.getvalue())

    # 清掉上一版的 PNG（public/ 会整目录进 dist/）
    for legacy in ("world.png", "world_mask.png"):
        p = os.path.join(APP_DATA_DIR, legacy)
        if os.path.exists(p):
            os.remove(p)

    meta = {
        "lon0": -180.0,
        "lon1": 180.0,
        "lat0": -LAT_LIMIT,
        "lat1": LAT_LIMIT,
        "gw": GRID,
        "gh": GRID,
        "min_elev": float(grid.min()),
        "max_elev": float(grid.max()),
        "map": {"P": N * TILE, "txOff": 0, "tyOff": 0, "cx0": 0, "cy0": 0, "cw": N * TILE, "ch": N * TILE},
    }
    with open(os.path.join(APP_DATA_DIR, "world.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print("world webp %d KB; mask webp %d KB; land %.1f%%" % (
        len(buf.getvalue()) // 1024, len(buf2.getvalue()) // 1024, land_ratio * 100))
    print("written:", APP_DATA_DIR)


if __name__ == "__main__":
    main()
