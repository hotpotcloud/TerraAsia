import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EARTH_R, GLOBE_U } from '../data/globe';
import { findProvince, indexProvinces, raycastFlat } from '../data/geo';
import { STEPS, camAt, globeCam, shotAt } from '../data/tour';
import { setSun } from './terrainMaterial';
import { useScene } from './SceneContext';
import { useAppStore } from '../state/store';
import { viewState } from './viewState';

/** drei OrbitControls 的最小接口（避免把 three-stdlib 的类型引进来） */
export interface OrbitLike {
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  update(): void;
  getAzimuthalAngle(): number;
}

const GLOBE_SUN = { az: 79, el: 34 };
const FLAT_SUN = { az: 315, el: 40 };
/** 相机离地最小净空（世界单位）：夸张 8.5× 时珠峰高约 9 单位 */
const EYE_CLEARANCE = 2.6;

/** 拾取结果：命中的经纬度与所在省份 */
export interface PickResult {
  lon: number;
  lat: number;
  prov: string | null;
}

interface Anim {
  t0: number;
  dur: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  g0: THREE.Vector3;
  g1: THREE.Vector3;
}

const easeInOut = (u: number) =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const easeSoft = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

/**
 * 场景桥接层：把 store 的离散状态、相机补间、逐帧 LOD、拾取、形变系数接在一起。
 * 这里只做调度 —— 几何与着色在各图层组件里。
 */
export function SceneBridge({
  controls,
  compassRef,
}: {
  controls: React.MutableRefObject<OrbitLike | null>;
  compassRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { data, handles } = useScene();
  const { asia: pack } = data;
  const { camera, gl, scene, size } = useThree();

  const viewMode = useAppStore((s) => s.viewMode);
  const exag = useAppStore((s) => s.exag);
  const sunAz = useAppStore((s) => s.sunAz);
  const sunEl = useAppStore((s) => s.sunEl);
  const shadow = useAppStore((s) => s.shadow);
  const ao = useAppStore((s) => s.ao);
  const step = useAppStore((s) => s.step);
  const autoTour = useAppStore((s) => s.autoTour);
  const autoRotate = useAppStore((s) => s.autoRotate);
  const replayKey = useAppStore((s) => s.replayKey);
  const flyKey = useAppStore((s) => s.flyKey);
  const flyKind = useAppStore((s) => s.flyKind);
  const select = useAppStore((s) => s.select);

  const provinces = useRef(indexProvinces(pack.json!.provinces));

  /* ---------- 形变过渡 ---------- */
  const mix = useRef(0);
  const tween = useRef({ from: 0, to: 0, t0: 0, dur: 1600 });

  /* ---------- 相机补间 ---------- */
  const anim = useRef<Anim | null>(null);
  const flyTo = (pose: { pos: [number, number, number]; tgt: [number, number, number] }, dur = 1800) => {
    anim.current = {
      t0: performance.now(),
      dur,
      p0: camera.position.clone(),
      p1: new THREE.Vector3(...pose.pos),
      g0: controls.current?.target.clone() ?? new THREE.Vector3(),
      g1: new THREE.Vector3(...pose.tgt),
    };
  };

  /* ---------- 开场：自东向西逐级升起 ---------- */
  const reveal = useRef({ t0: 0, on: true });

  // 第一步：打开页面先落到第 0 步机位，然后开始开场动画
  useEffect(() => {
    const pose = shotAt(pack, exag, 0);
    camera.position.set(...pose.pos);
    controls.current?.target.set(...pose.tgt);
    controls.current?.update();
    reveal.current = { t0: performance.now(), on: true };
    viewState.revealed = false;
    scene.fog = new THREE.Fog(0x060d16, 150 * pack.proj.K, 420 * pack.proj.K);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 重播
  useEffect(() => {
    if (replayKey === 0) return;
    reveal.current = { t0: performance.now(), on: true };
    viewState.revealed = false;
  }, [replayKey]);

  // 导览步进 → 飞过去
  useEffect(() => {
    flyTo(shotAt(pack, exag, step), 2000);
    if (handles.asiaUniforms) {
      const dim = STEPS[step % STEPS.length].dim;
      (handles.asiaUniforms.uDim.value as THREE.Vector3).set(dim[0], dim[1], dim[2]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 视角快捷键
  useEffect(() => {
    if (flyKey === 0) return;
    if (flyKind === 'asia') flyTo(camAt(pack, exag, 101, 50, 286, 0.3, 48), 1800);
    else if (flyKind === 'cn') flyTo(camAt(pack, exag, 104, 35, 150, 0.49, 38), 1800);
    else flyTo(shotAt(pack, exag, useAppStore.getState().step), 1800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  /* ---------- 视图模式 ---------- */
  const prevSun = useRef(FLAT_SUN);
  useEffect(() => {
    const toGlobe = viewMode === 'globe';
    tween.current = {
      from: mix.current,
      to: toGlobe ? 1 : 0,
      t0: performance.now(),
      dur: 1600,
    };
    if (toGlobe) {
      prevSun.current = { az: sunAz, el: sunEl };
      setSun(GLOBE_SUN.az, GLOBE_SUN.el);
      useAppStore.getState().setSun(GLOBE_SUN.az, GLOBE_SUN.el);
      scene.fog = null;
      flyTo(globeCam(), 1600);
    } else {
      setSun(prevSun.current.az, prevSun.current.el);
      useAppStore.getState().setSun(prevSun.current.az, prevSun.current.el);
      scene.fog = new THREE.Fog(0x060d16, 150 * pack.proj.K, 420 * pack.proj.K);
      flyTo(shotAt(pack, exag, step), 1600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // 相机约束随模式切换
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (viewMode === 'globe') {
      c.minDistance = EARTH_R * 1.16;
      c.maxDistance = EARTH_R * 8;
      c.maxPolarAngle = Math.PI * 0.92;
    } else {
      c.minDistance = 12;
      c.maxDistance = 300 * pack.proj.K;
      c.maxPolarAngle = Math.PI * 0.495;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, controls.current]);

  /* ---------- 光照与开关 ---------- */
  useEffect(() => {
    setSun(sunAz, sunEl);
  }, [sunAz, sunEl]);

  useEffect(() => {
    if (handles.asiaUniforms) handles.asiaUniforms.uShadowOn.value = shadow ? 1 : 0;
  }, [shadow, handles]);

  useEffect(() => {
    if (handles.asiaUniforms) handles.asiaUniforms.uAOAmt.value = ao ? 1 : 0;
  }, [ao, handles]);

  useEffect(() => {
    if (controls.current) controls.current.autoRotate = autoRotate;
  }, [autoRotate, controls]);

  // 太阳方向对象是共享的，改 az/el 时地球装饰也要跟着醒一次
  useEffect(() => {
    const t = setInterval(() => {
      /* 地球模式下光源方向变化需要重绘一帧；r3f 默认每帧都画，这里只做兜底 */
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* ---------- 拾取 ---------- */
  /** 屏幕 NDC → 经纬度 → 省份。抽成纯函数，既给 pointerup 用，也给标定脚本用 */
  const pickRef = useRef<((nx: number, ny: number) => PickResult | null) | null>(null);

  useEffect(() => {
    const dom = gl.domElement;
    let down: [number, number] | null = null;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const pickAt = (nx: number, ny: number): PickResult | null => {
      ndc.set(nx, ny);
      // 相机矩阵可能还没在本帧更新（比如刚 camAt 完），这里强制刷新一次再求交
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;

      let lonLat: [number, number] | null = null;
      if (GLOBE_U.value > 0.5) {
        // 球面解析求交
        const b = o.dot(d);
        const c = o.lengthSq() - EARTH_R * EARTH_R;
        const disc = b * b - c;
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc);
        if (t < 0) return null;
        const p = o.clone().addScaledVector(d, t);
        const lat = (Math.asin(Math.max(-1, Math.min(1, p.y / p.length()))) * 180) / Math.PI;
        const lon = (Math.atan2(p.x, p.z) * 180) / Math.PI;
        lonLat = [lon, lat];
      } else {
        const hit = raycastFlat(o, d, pack.sampleHeight, exag * pack.proj.V0);
        if (!hit) return null;
        const [x, , z] = hit;
        if (!pack.proj.insideWorld(x, z)) return null;
        lonLat = pack.proj.worldToLonLat(x, z);
      }

      const pv = findProvince(provinces.current, lonLat[0], lonLat[1]);
      return { lon: +lonLat[0].toFixed(3), lat: +lonLat[1].toFixed(3), prov: pv ? pv.name : null };
    };
    pickRef.current = pickAt;

    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down[0];
      const dy = e.clientY - down[1];
      down = null;
      if (dx * dx + dy * dy > 36) return; // 拖拽旋转不算点击

      const r = dom.getBoundingClientRect();
      const hit = pickAt(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const pv = hit?.prov ? provinces.current.find((p) => p.name === hit.prov) : null;
      select(pv ? { name: pv.name, avg: pv.avg, tier: pv.tier } : null);
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      pickRef.current = null;
    };
  }, [gl, camera, pack, exag, select]);

  /* ---------- 每帧 ---------- */
  const autoTimer = useRef(0);

  useFrame((_, dt) => {
    const now = performance.now();

    // 形变过渡：按时间推进，不按帧插值 —— 低帧率下指数插值会卡在中间态
    if (Math.abs(mix.current - tween.current.to) > 1e-5) {
      const u = Math.min(1, (now - tween.current.t0) / tween.current.dur);
      mix.current =
        tween.current.from + (tween.current.to - tween.current.from) * easeSoft(u);
      if (u >= 1) mix.current = tween.current.to;
      GLOBE_U.value = mix.current;
      viewState.mix = mix.current;
    }

    // 开场动画
    if (reveal.current.on) {
      const k = Math.min(1, (now - reveal.current.t0) / 5200);
      if (handles.asiaUniforms) handles.asiaUniforms.uReveal.value = k;
      if (k >= 1) {
        reveal.current.on = false;
        viewState.revealed = true;
      }
    }

    // 相机补间
    if (anim.current) {
      const a = anim.current;
      const u = Math.min(1, (now - a.t0) / a.dur);
      const e = easeInOut(u);
      camera.position.lerpVectors(a.p0, a.p1, e);
      if (controls.current) {
        controls.current.target.lerpVectors(a.g0, a.g1, e);
        controls.current.update();
      }
      if (u >= 1) anim.current = null;
    }

    // 相机贴地：夸张度拉高时绕轨很容易钻进山里，按落点地形高度兜住
    if (mix.current < 0.5) {
      const h = pack.sampleHeight(camera.position.x, camera.position.z) * exag * pack.proj.V0;
      const floor = h + EYE_CLEARANCE;
      if (camera.position.y < floor) camera.position.y = floor;
    } else {
      const r = camera.position.length();
      const dirLen = r || 1;
      const groundY = pack.sampleHeight(camera.position.x, camera.position.z) * exag * pack.proj.V0;
      const floor = EARTH_R + groundY + EYE_CLEARANCE;
      if (dirLen < floor) camera.position.multiplyScalar(floor / dirLen);
    }

    // LOD：相机越近显示越细（大区 → 省会 → 重点城市 → 景区）
    const dist = controls.current
      ? camera.position.distanceTo(controls.current.target)
      : camera.position.length();
    viewState.camDist = dist;
    const lod = dist > 110 ? 0 : dist > 58 ? 1 : dist > 34 ? 2 : 3;
    if (lod !== viewState.lod) viewState.lod = lod;

    // 省份选中高亮的淡入淡出
    const targetSel = useAppStore.getState().selected ? 1 : 0;
    viewState.selAmt += (targetSel - viewState.selAmt) * 0.12;
    if (Math.abs(targetSel - viewState.selAmt) < 0.002) viewState.selAmt = targetSel;
    if (handles.asiaUniforms) handles.asiaUniforms.uSelAmt.value = viewState.selAmt;

    // 指北针
    if (compassRef?.current && controls.current) {
      const az = (controls.current.getAzimuthalAngle() * 180) / Math.PI;
      compassRef.current.style.transform = `rotate(${-az}deg)`;
    }

    // 自动演示
    if (autoTour) {
      autoTimer.current += dt;
      if (autoTimer.current > 9.5) {
        autoTimer.current = 0;
        const s = useAppStore.getState();
        s.setStep((s.step + 1) % STEPS.length);
      }
    } else {
      autoTimer.current = 0;
    }
  });

  // 尺寸变化时保持相机比例
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
    }
  }, [camera, size.width, size.height]);

  // 机位调试接口（标定截图用）
  useEffect(() => {
    interface DebugWindow extends Window {
      __ta?: Record<string, unknown>;
    }
    (window as DebugWindow).__ta = {
      camAt: (lon: number, lat: number, dist = 40, az = 0.5, elev = 35) => {
        const p = camAt(pack, exag, lon, lat, dist, az, elev);
        anim.current = null;
        camera.position.set(...p.pos);
        controls.current?.target.set(...p.tgt);
        controls.current?.update();
        return p;
      },
      view: (m: 'flat' | 'globe') => useAppStore.getState().setViewMode(m),
      step: (i: number) => useAppStore.getState().setStep(i),
      sun: (az: number, el: number) => useAppStore.getState().setSun(az, el),
      /** 屏幕归一化坐标（-1..1）处拾取，用于标定与回归脚本 */
      pick: (nx = 0, ny = 0) => pickRef.current?.(nx, ny) ?? null,
      cam: () => ({
        pos: camera.position.toArray().map((n) => +n.toFixed(2)),
        tgt: (controls.current?.target.toArray() ?? [0, 0, 0]).map((n) => +n.toFixed(2)),
      }),
      info: () => ({
        mix: +mix.current.toFixed(3),
        lod: viewState.lod,
        camDist: +viewState.camDist.toFixed(1),
        revealed: viewState.revealed,
        exag,
        viewMode,
      }),
      uniforms: () => handles.asiaUniforms,
    };
  }, [camera, controls, pack, exag, viewMode, handles]);

  return null;
}
