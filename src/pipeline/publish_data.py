# -*- coding: utf-8 -*-
"""发布前端数据: 把 build/data.split.json 拆成静态资源

原来所有东西（3.4 MB 的 base64 PNG + 向量数据）都内联进单文件 HTML。改成静态站点后
拆开更划算：
    terrain.webp  地形编码图（R,G=高程 / B=阶梯·水深）
    mask.webp     陆地掩膜
    data.json     meta + 矢量数据 + 地级市（不含图片）

这样浏览器能分别缓存，也能先出地形再补矢量；省域高精补丁以后按需追加，
不用重打整包。

为什么用无损 WebP 而不是 PNG：这两张图是**数据**不是照片，R,G 两个字节拼成 16 位
高程。有损压缩会把相邻像素的高位字节改掉（实测 p99 误差 18 km、26% 的像素
"境内/境外"判定翻转），所以只能 lossless。无损 WebP 比 PNG 小 25~30%，
在 3 Mbps 的小带宽上等于省 1 秒多首屏时间。
"""
import base64
import io
import json
import os
import sys

from PIL import Image, features

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import APP_DATA_DIR, BUILD_SPLIT_JSON, CITIES_JSON   # noqa: E402


def write_webp(b64: str, path: str, mode: str) -> int:
    """把 base64 的 PNG 解出来，按指定通道数无损转存 WebP。

    mode: 地形/底图用 'RGB'（alpha 用不上，掩膜已拆成独立文件）；掩膜用 'L'。
    """
    raw = base64.b64decode(b64)
    im = Image.open(io.BytesIO(raw)).convert(mode)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", lossless=True, quality=100, method=6)
    data = buf.getvalue()
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def main():
    if not features.check("webp"):
        raise SystemExit("当前 Pillow 没有 WebP 支持，无法输出无损 WebP（装带 libwebp 的 Pillow）")
    if not os.path.exists(BUILD_SPLIT_JSON):
        raise SystemExit(f"缺少输入 {BUILD_SPLIT_JSON}，请先执行 npm run build:data")

    d = json.load(open(BUILD_SPLIT_JSON, encoding='utf-8'))
    os.makedirs(APP_DATA_DIR, exist_ok=True)

    png = d.pop('png', None)
    mask = d.pop('maskPng', None)
    if not png or not mask:
        raise SystemExit("data.split.json 缺少 png / maskPng，检查 split_mask 是否跑过")

    n1 = write_webp(png, os.path.join(APP_DATA_DIR, 'terrain.webp'), 'RGB')
    n2 = write_webp(mask, os.path.join(APP_DATA_DIR, 'mask.webp'), 'L')

    # 清掉上一版的 PNG：public/ 会被整目录拷进 dist/，两套并存等于白发一倍流量
    for legacy in ('terrain.png', 'mask.png'):
        p = os.path.join(APP_DATA_DIR, legacy)
        if os.path.exists(p):
            os.remove(p)

    if os.path.exists(CITIES_JSON):
        d['cities'] = json.load(open(CITIES_JSON, encoding='utf-8'))

    out = os.path.join(APP_DATA_DIR, 'data.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

    # 自检：矢量数据不能为空，省份数固定 33（含港澳台）
    if len(d.get('provinces', [])) != 33:
        raise SystemExit(f"省份数异常：{len(d.get('provinces', []))}，应为 33")

    print('terrain.webp %d KB; mask.webp %d KB; data.json %d KB' % (
        n1 // 1024, n2 // 1024, os.path.getsize(out) // 1024))
    print('written:', APP_DATA_DIR)


if __name__ == '__main__':
    main()
