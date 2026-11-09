# -*- coding: utf-8 -*-
"""发布前端数据: 把 build/data.split.json 拆成静态资源

原来所有东西（3.4 MB 的 base64 PNG + 向量数据）都内联进单文件 HTML。改成静态站点后
拆开更划算：
    terrain.png   地形编码图（R,G=高程 / B=阶梯·水深）
    mask.png      陆地掩膜
    data.json     meta + 矢量数据 + 地级市（不含图片）

这样浏览器能分别缓存，也能先出地形再补矢量；省域高精补丁以后按需追加，
不用重打整包。
"""
import base64
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import APP_DATA_DIR, BUILD_SPLIT_JSON, CITIES_JSON   # noqa: E402


def write_b64_png(b64: str, path: str) -> int:
    raw = base64.b64decode(b64)
    with open(path, "wb") as f:
        f.write(raw)
    return len(raw)


def main():
    if not os.path.exists(BUILD_SPLIT_JSON):
        raise SystemExit(f"缺少输入 {BUILD_SPLIT_JSON}，请先执行 npm run build:data")

    d = json.load(open(BUILD_SPLIT_JSON, encoding='utf-8'))
    os.makedirs(APP_DATA_DIR, exist_ok=True)

    png = d.pop('png', None)
    mask = d.pop('maskPng', None)
    if not png or not mask:
        raise SystemExit("data.split.json 缺少 png / maskPng，检查 split_mask 是否跑过")

    n1 = write_b64_png(png, os.path.join(APP_DATA_DIR, 'terrain.png'))
    n2 = write_b64_png(mask, os.path.join(APP_DATA_DIR, 'mask.png'))

    if os.path.exists(CITIES_JSON):
        d['cities'] = json.load(open(CITIES_JSON, encoding='utf-8'))

    out = os.path.join(APP_DATA_DIR, 'data.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

    # 自检：矢量数据不能为空，省份数固定 33（含港澳台）
    if len(d.get('provinces', [])) != 33:
        raise SystemExit(f"省份数异常：{len(d.get('provinces', []))}，应为 33")

    print('terrain.png %d KB; mask.png %d KB; data.json %d KB' % (
        n1 // 1024, n2 // 1024, os.path.getsize(out) // 1024))
    print('written:', APP_DATA_DIR)


if __name__ == '__main__':
    main()
