import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useFrame, useThree } from '@react-three/fiber';
import { GLOBE_U, toGlobe } from '../data/globe';
import {
  ASIA_F,
  CITIES,
  GROUP_OF,
  LABELS,
  LOD_OF,
  NEIGHBORS,
  RAIL,
  ROAD,
  SCENIC,
  midOf,
  type LabelType,
} from '../data/static';
import { useScene } from './SceneContext';
import { useAppStore, type LabelGroupKey } from '../state/store';
import { viewState } from './viewState';

interface Item {
  obj: CSS2DObject;
  el: HTMLDivElement;
  x: number;
  z: number;
  y: number;
  off: number;
  group: string;
  lod: number;
  /** 屏幕尺寸缓存（px），挂载时量一次 */
  w: number;
  h: number;
  /** 标注类型，用来查优先级表 */
  type: string;
  /** 当前纵向微调量（px，负值向上）；避让时写入，带滞回所以不会逐帧抖 */
  nudge: number;
}

interface RawLabel {
  name: string;
  lon: number;
  lat: number;
  type: LabelType;
}

/**
 * 标注优先级：数字小的先占位，撞车时让位的是数字大的。
 *
 * 分两套，随 LOD 切换而不是取固定值：
 *   · 远景读「阶梯」——地形区（高原/盆地/平原）与分界山脉必须留下，城市名先让
 *   · 近景读「地方」——省会与景区先占位，山脉名退后
 * 放在一套固定优先级里总有一头受委屈：实测固定顺序时「青藏高原」会被「昆仑山」挤掉。
 */
const PRIO_FAR: Record<string, number> = {
  t: 0,
  m: 1,
  p: 2,
  r: 2,
  c1: 3,
  i: 4,
  l: 4,
  w: 5,
  s: 6,
  cc: 7,
  v: 8,
  u: 8,
  c2: 9,
  c: 10,
  rl: 11,
  rd: 11,
  n: 12,
  nf: 13,
};

const PRIO_NEAR: Record<string, number> = {
  c1: 0,
  cc: 1,
  p: 2,
  s: 3,
  t: 4,
  i: 4,
  l: 4,
  w: 5,
  m: 6,
  r: 7,
  v: 8,
  u: 8,
  c2: 9,
  c: 10,
  rl: 11,
  rd: 11,
  n: 12,
  nf: 13,
};

/** 屏幕上两个标注之间的最小留白（px） */
const PAD_X = 3;
const PAD_Y = 1.5;

/**
 * 撞车时的候选纵向偏移（px）：原位 → 上/下一行 → 上/下两行。
 * 只挪一两行，锚点还在原来的地形要素附近，不至于读错位置。
 */
const OFFSETS = [0, -18, 18, -34, 34];

/** 批量量一次尺寸：写入一批、读取一批，只触发两次布局 */
function measure(list: Item[], host: HTMLElement) {
  if (!list.length) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
  for (const it of list) probe.appendChild(it.el);
  host.appendChild(probe);
  for (const it of list) {
    it.w = it.el.offsetWidth || it.w;
    it.h = it.el.offsetHeight || it.h;
  }
  for (const it of list) probe.removeChild(it.el);
  host.removeChild(probe);
}

/**
 * 标注层（CSS2D）。
 *
 * 用 three 自带的 CSS2DRenderer 而不是把 84 个 div 交给 React 渲染：
 * 位置每帧都在变，走 React 就是一帧一次 setState；CSS2DRenderer 直接写
 * transform，React 只负责这一次性的 DOM 结构。
 *
 * 三层筛选，从便宜到贵：
 *   1) 语义可见：图层开关 + LOD + 球面背面剔除
 *   2) 屏幕空间避让：按优先级依次占位，与已占矩形相交的低优先级标注让位
 *   3) 交给 CSS2DRenderer 写 transform（它自己也会做视锥与 z 剔除）
 */
export function LabelLayer({ host }: { host: HTMLDivElement }) {
  const { data } = useScene();
  const pack = data.asia;
  const { scene, camera, size } = useThree();
  const exag = useAppStore((s) => s.exag);
  const selected = useAppStore((s) => s.selected);
  const labelGroups = useAppStore((s) => s.labelGroups);
  const layers = useAppStore((s) => s.layers);

  const groupsRef = useRef(labelGroups);
  groupsRef.current = labelGroups;

  /* ---------- 全部静态标注 ---------- */
  const raw = useMemo<RawLabel[]>(() => {
    const out: RawLabel[] = [];
    for (const [name, lon, lat, type] of LABELS) out.push({ name, lon, lat, type });
    for (const [name, lon, lat, type] of CITIES) out.push({ name, lon, lat, type });
    for (const [name, lon, lat] of NEIGHBORS) out.push({ name, lon, lat, type: 'n' });
    for (const [name, lon, lat] of ASIA_F) out.push({ name, lon, lat, type: 'nf' });
    for (const [name, lon, lat, type] of SCENIC) out.push({ name, lon, lat, type });
    // 线路名取弧长比例点：铁路 45% / 公路 62%，避免同走廊两条线名字撞在一起
    for (const [name, line] of Object.entries(RAIL)) {
      const q = midOf(line, 0.45);
      out.push({ name, lon: q[0], lat: q[1], type: 'rl' });
    }
    for (const [name, line] of Object.entries(ROAD)) {
      const q = midOf(line, 0.62);
      out.push({ name, lon: q[0], lat: q[1], type: 'rd' });
    }
    return out;
  }, []);

  /* ---------- 建对象 ---------- */
  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    for (const r of raw) {
      const el = document.createElement('div');
      el.className = `lb lb-${r.type}`;
      el.textContent = r.name;
      const obj = new CSS2DObject(el);
      const w = pack.proj.lonLatToWorld(r.lon, r.lat);
      obj.position.set(w[0], 0, w[1]);
      const isWater = r.type === 'w' || r.type === 'i';
      const lod = LOD_OF[r.type] ?? 0;
      list.push({
        obj,
        el,
        x: w[0],
        z: w[1],
        y: 0,
        off: isWater ? 0.25 : lod > 0 ? 0.3 : 0.5,
        group: GROUP_OF[r.type] ?? 'm',
        lod,
        // 量尺寸前的兜底估算：汉字按 1em、西文按 0.55em，只在首帧用到
        w: r.name.length * 11.5 * 0.92,
        h: 15,
        type: r.type,
        nudge: 0,
      });
    }
    return list;
  }, [raw, pack]);

  /* ---------- 点选省份后的地级市名 ---------- */
  const cityItems = useMemo<Item[]>(() => {
    if (!selected || !pack.json?.cities) return [];
    const rows = pack.json.cities[selected.name];
    if (!rows) return [];
    return rows.map((row) => {
      const el = document.createElement('div');
      el.className = 'lb lb-cc';
      el.textContent = row[0];
      const obj = new CSS2DObject(el);
      const w = pack.proj.lonLatToWorld(row[1], row[2]);
      obj.position.set(w[0], 0, w[1]);
      return {
        obj,
        el,
        x: w[0],
        z: w[1],
        y: 0,
        off: 0.46,
        group: 'cc',
        lod: 1,
        w: row[0].length * 11.5 * 0.92,
        h: 15,
        type: 'cc',
        nudge: 0,
      };
    });
  }, [selected, pack]);

  const all = useMemo(() => [...items, ...cityItems], [items, cityItems]);

  /**
   * 两套顺序在构建时就排好，运行时只按 lod 选一套 —— 顺序稳定，重叠结果才不会逐帧闪。
   */
  const orders = useMemo(() => {
    const pick = (table: Record<string, number>) =>
      [...all].sort((a, b) => (table[a.type] ?? 99) - (table[b.type] ?? 99));
    return { far: pick(PRIO_FAR), near: pick(PRIO_NEAR) };
  }, [all]);

  /* ---------- 场景挂载 + CSS2D 渲染器 ---------- */
  const renderer = useMemo(() => {
    const r = new CSS2DRenderer();
    r.domElement.style.position = 'absolute';
    r.domElement.style.top = '0';
    r.domElement.style.left = '0';
    r.domElement.style.pointerEvents = 'none';
    return r;
  }, []);

  useEffect(() => {
    const group = new THREE.Group();
    for (const it of all) group.add(it.obj);
    scene.add(group);
    return () => {
      scene.remove(group);
      for (const it of all) {
        it.obj.element.remove();
        group.remove(it.obj);
      }
    };
  }, [scene, all]);

  useEffect(() => {
    host.appendChild(renderer.domElement);
    return () => {
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [host, renderer]);

  useEffect(() => {
    renderer.setSize(size.width, size.height);
  }, [renderer, size.width, size.height]);

  // 元素进了 DOM 才量得准；量完把 probe 拆掉，元素交给 CSS2DRenderer 接管
  useEffect(() => {
    measure(all, host);
  }, [all, host]);

  // 贴地高度：夸张度变了才重算，不占每帧
  useEffect(() => {
    for (const it of all) {
      it.y = pack.sampleHeight(it.x, it.z) * exag * pack.proj.V0 + it.off;
      if (GLOBE_U.value <= 0.0001) it.obj.position.set(it.x, it.y, it.z);
    }
  }, [all, exag, pack]);

  /* ---------- 每帧：搬位置 → 分显隐 → 避让 → 渲染 ---------- */
  const scratch = useRef({ x: 0, y: 0, z: 0 });
  const lastMix = useRef(-1);
  const ndc = useRef(new THREE.Vector3());
  /** 已占用的屏幕矩形（x0,y0,x1,y1 连续写入，避免每帧建数组） */
  const taken = useRef(new Float32Array(4 * 512));

  useFrame(() => {
    const mix = GLOBE_U.value;

    // 1) 形变：球面模式下标注要跟着地形一起卷到球面上
    if (Math.abs(mix - lastMix.current) > 0.0004) {
      lastMix.current = mix;
      if (mix > 0.0001) {
        const s = scratch.current;
        for (const it of all) {
          toGlobe(data.asiaMap, it.x, it.y, it.z, mix, s);
          it.obj.position.set(s.x, s.y, s.z);
        }
      } else {
        for (const it of all) it.obj.position.set(it.x, it.y, it.z);
      }
    }

    const vis = groupsRef.current;
    const revealed = viewState.revealed;
    const lod = viewState.lod;

    /* 球面模式下 CSS2D 没有深度遮挡，背面的标注会透过地球显示出来。
       用法线与视线的夹角剔除：背向相机的一律不显示。 */
    const camLen = camera.position.length() || 1;
    const cnx = camera.position.x / camLen;
    const cny = camera.position.y / camLen;
    const cnz = camera.position.z / camLen;
    const spherical = mix > 0.5;

    const W = size.width;
    const H = size.height;
    const v = ndc.current;
    const rects = taken.current;
    // 近景优先读城市，远景优先读阶梯 —— 两套顺序在构建时排好
    const order = lod >= 2 ? orders.near : orders.far;
    let n = 0;

    for (const it of order) {
      // 2) 语义可见
      let want = revealed && lod >= it.lod;
      if (want) {
        want =
          it.group === 'cc' ? layers.cityDiv && lod >= 1 : vis[it.group as LabelGroupKey] !== false;
      }
      if (want && spherical) {
        const p = it.obj.position;
        const len = p.length() || 1;
        want = (p.x * cnx + p.y * cny + p.z * cnz) / len > 0.18;
      }
      if (!want) {
        if (it.obj.visible) it.obj.visible = false;
        continue;
      }

      // 3) 屏幕空间避让：先试着在原位放，撞了就上下挪一行，挪不开才让位
      v.copy(it.obj.position).project(camera);
      if (v.z > 1) {
        if (it.obj.visible) it.obj.visible = false;
        continue;
      }
      const cx = (v.x * 0.5 + 0.5) * W;
      const cy0 = (-v.y * 0.5 + 0.5) * H;
      const hw = it.w / 2 + PAD_X;
      const hh = it.h / 2 + PAD_Y;

      let dy = 0;
      let ok = false;
      // k=-1 先试上一帧的位置（滞回）：镜头微动时不要在两个候选点之间来回跳
      for (let k = -1; k < OFFSETS.length; k++) {
        dy = k < 0 ? it.nudge : OFFSETS[k];
        if (k >= 0 && dy === it.nudge && it.nudge !== 0) continue; // -1 那一轮已经试过
        const cy = cy0 - dy;
        const y0 = cy - hh;
        const y1 = cy + hh;
        let hit = false;
        for (let i = 0; i < n; i += 4) {
          if (cx - hw < rects[i + 2] && cx + hw > rects[i] && y0 < rects[i + 3] && y1 > rects[i + 1]) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          ok = true;
          break;
        }
      }

      if (!ok) {
        if (it.obj.visible) it.obj.visible = false;
        continue;
      }

      // 用 CSS2DObject.center 实现纵向偏移：center.y 换算成百分比位移，不跟渲染器抢 transform
      if (dy !== it.nudge) {
        it.nudge = dy;
        it.obj.center.y = 0.5 + dy / it.h;
      }
      const cy = cy0 - dy;
      if (n + 4 <= rects.length) {
        rects[n] = cx - hw;
        rects[n + 1] = cy - hh;
        rects[n + 2] = cx + hw;
        rects[n + 3] = cy + hh;
        n += 4;
      }
      if (!it.obj.visible) it.obj.visible = true;
    }

    renderer.render(scene, camera);
  });

  return null;
}
