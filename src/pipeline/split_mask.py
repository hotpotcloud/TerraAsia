# -*- coding: utf-8 -*-
"""拆包: 把地形 PNG 的 A 通道(陆地掩膜)拆成独立灰度图, 地形图 A 恒 255

原因: canvas 2D 预乘 alpha 会把 A=0 像素的 RGB 清零, 内陆水面/海洋的水深色会丢。

输入  build/data.json       (prep_data 产出, png 带 alpha)
输出  build/data.split.json (png 的 A 恒 255, 掩膜另存为 maskPng)

注意: 本脚本不改写输入文件。若写成原地覆盖, 第二次运行读到的 png 已经是
A=255, 掩膜会退化成"全是陆地", 海洋被当成境外陆地渲染成土黄色。
"""
import json, io, base64, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BUILD_JSON, BUILD_SPLIT_JSON   # noqa: E402


def main():
    if not os.path.exists(BUILD_JSON):
        raise SystemExit(f"缺少输入 {BUILD_JSON}，请先执行 npm run data")

    d = json.load(open(BUILD_JSON, encoding='utf-8'))
    img = Image.open(io.BytesIO(base64.b64decode(d['png']))).convert('RGBA')
    a = np.asarray(img).copy()
    mask = a[..., 3].copy()

    # 输入自检: png 的 A 必须还有区分度, 否则说明拿到的是已拆过的产物
    land_ratio = float((mask >= 128).mean())
    if not (0.02 <= land_ratio <= 0.95):
        raise SystemExit(
            f"输入 png 的 alpha 陆地占比异常({land_ratio:.1%})，"
            "说明 build/data.json 不是原始产物(可能被拆包结果覆盖过)。"
            "请重新执行 npm run data 生成原始数据。"
        )

    a[..., 3] = 255
    buf = io.BytesIO()
    Image.fromarray(a, 'RGBA').save(buf, format='PNG', optimize=True)
    d['png'] = base64.b64encode(buf.getvalue()).decode()

    buf2 = io.BytesIO()
    Image.fromarray(mask, 'L').save(buf2, format='PNG', optimize=True)
    d['maskPng'] = base64.b64encode(buf2.getvalue()).decode()

    with open(BUILD_SPLIT_JSON, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

    print('terrain png %d KB; mask png %d KB; land %.1f%%' % (
        len(buf.getvalue()) // 1024, len(buf2.getvalue()) // 1024, land_ratio * 100))
    print('written:', BUILD_SPLIT_JSON)


if __name__ == '__main__':
    main()
