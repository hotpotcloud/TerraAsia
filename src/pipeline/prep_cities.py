# -*- coding: utf-8 -*-
"""抓取省级下的地级市(直辖市为区)边界, 抽稀后输出 data/cities.json
用法: python data/prep_cities.py
输出结构: { "四川省": [ [名称, 中心经度, 中心纬度, [ring...]], ... ] }
ring 为 [[lon,lat], ...] 闭合环(3 位小数)
"""
import json, os, math, time, urllib.request

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import SOURCE_DIR, CACHE_DIR, DATASET_DIR   # noqa: E402
CACHE = os.path.join(CACHE_DIR, 'city_json')
OUT = os.path.join(DATASET_DIR, 'cities.json')
TOL = 0.013          # 抽稀容差(度), 约 1.4km
MIN_AREA = 0.0026    # 丢弃碎环(度²), 约 32km²
DROP_RING_IF_LARGER_THAN = 6.0   # 跨度过大且点多的环(多为海岸/飞地噪声)

os.makedirs(CACHE, exist_ok=True)
os.makedirs(DATASET_DIR, exist_ok=True)


def rdp(pts, tol):
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
    i = max(range(len(d)), key=lambda k: d[k])
    if d[i] > tol:
        return rdp(pts[:i + 1], tol)[:-1] + rdp(pts[i:], tol)
    return [pts[0], pts[-1]]


def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]; x2, y2 = ring[i + 1]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def fetch(adcode):
    p = os.path.join(CACHE, f'{adcode}_full.json')
    if os.path.exists(p) and os.path.getsize(p) > 200:
        return json.load(open(p, encoding='utf-8'))
    url = f'https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 geo-sandbox/1.0'})
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(req, timeout=25).read().decode('utf-8')
            json.loads(raw)                      # 校验
            open(p, 'w', encoding='utf-8').write(raw)
            return json.loads(raw)
        except Exception as e:
            if attempt == 2:
                print(f'  ! {adcode} 失败: {e}')
                return None
            time.sleep(1.4)


def polys_of(geom):
    """返回 [[ring...]] , 兼容 Polygon / MultiPolygon"""
    t = geom.get('type')
    co = geom.get('coordinates') or []
    if t == 'Polygon':
        return [co]
    if t == 'MultiPolygon':
        return co
    return []


def simplify_rings(polys):
    out = []
    for poly in polys:
        for ring in poly[:1]:                    # 只取外环, 内环(飞地洞)对教学无意义
            if len(ring) < 4:
                continue
            pts = [(float(x), float(y)) for x, y in ring]
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            if ring_area(pts) < MIN_AREA:
                continue
            if max(w, h) > DROP_RING_IF_LARGER_THAN:
                continue
            simp = rdp(pts, TOL)
            if len(simp) < 4:
                continue
            out.append([[round(x, 3), round(y, 3)] for x, y in simp])
    return out


def main():
    bound = json.load(open(os.path.join(SOURCE_DIR, 'china_bound_full.json'), encoding='utf-8'))
    provs = []
    for f in bound['features']:
        pr = f['properties']
        ad = str(pr.get('adcode') or '')
        nm = pr.get('name') or ''
        if not ad.endswith('0000') or ad.startswith('100000'):
            continue
        if nm in ('南海诸岛',):
            continue
        provs.append((nm, ad))
    print('省级单元:', len(provs))

    result, total_pts, total_city = {}, 0, 0
    for nm, ad in provs:
        d = fetch(ad)
        if not d or 'features' not in d:
            print(f'{nm}: 跳过')
            continue
        cities = []
        for f in d['features']:
            pr = f.get('properties') or {}
            cname = pr.get('name') or ''
            if not cname or cname in ('南海诸岛',):
                continue
            center = pr.get('center') or []
            rings = simplify_rings(polys_of(f.get('geometry') or {}))
            if not rings:
                continue
            if len(center) != 2:
                c = rings[0]
                center = [sum(p[0] for p in c) / len(c), sum(p[1] for p in c) / len(c)]
            cities.append([cname, round(float(center[0]), 3), round(float(center[1]), 3), rings])
            total_pts += sum(len(r) for r in rings)
        if cities:
            result[nm] = cities
            total_city += len(cities)
            print(f'{nm}: {len(cities)} 个')
    json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    sz = os.path.getsize(OUT) / 1024
    print(f'\n写出 {OUT}  {sz:.0f} KB  共 {total_city} 个市级单元 / {total_pts} 点')


if __name__ == '__main__':
    main()
