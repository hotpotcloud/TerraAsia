import { useEffect, useRef, useState } from 'react';
import {
  decodeFieldPack,
  fetchFieldPack,
  type FieldPack,
  type LoadOptions,
} from './data/terrainLoader';
import { SceneView } from './scene/SceneView';
import { Compass, Foot, Hint, LoadingScreen, TopBar } from './ui/Chrome';
import { WorkPanel } from './ui/SidePanel';
import { useAppStore } from './state/store';

const BASE = `${import.meta.env.BASE_URL}data/`;

/** 两级精度：全球粗网格（~860 KB）与亚洲高精网格（~1.9 MB） */
const WORLD: LoadOptions = {
  metaUrl: `${BASE}world.json`,
  pngUrl: `${BASE}world.webp`,
  maskUrl: `${BASE}world_mask.webp`,
};
const ASIA: LoadOptions = {
  jsonUrl: `${BASE}data.json`,
  pngUrl: `${BASE}terrain.webp`,
  maskUrl: `${BASE}mask.webp`,
};

interface Packs {
  asia: FieldPack;
  world: FieldPack;
}

/** 六个数据文件的未压缩总字节数（兜底分母）。正常走各文件 Content-Length 之和，
 *  但当服务器用 chunked 编码（无 Content-Length）时用它兜底，保证进度条仍能显示。
 *  未压缩值作分母是安全的：实际传输（gzip 后）只会更小，进度永不超 100%。 */
const TOTAL_ESTIMATE = 3590728;

export default function App() {
  const [packs, setPacks] = useState<Packs | null>(null);
  const [mb, setMb] = useState(0);
  const [pct, setPct] = useState(0);
  const bytesRef = useRef(0);
  const totalRef = useRef(0);
  const stage = useAppStore((s) => s.stage);
  const error = useAppStore((s) => s.error);
  const setStage = useAppStore((s) => s.setStage);
  const setError = useAppStore((s) => s.setError);
  const activePanel = useAppStore((s) => s.activePanel);
  const viewMode = useAppStore((s) => s.viewMode);
  const compassRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 只显示真实下载量（按 0.1 MB 取整，避免每来一块就重渲染）
    const addBytes = (n: number) => {
      bytesRef.current += n;
      const v = Math.floor((bytesRef.current / 1048576) * 10) / 10;
      setMb((prev) => (v > prev ? v : prev));
      // 进度百分比：优先用 Content-Length 之和，拿不到（chunked 编码）就兜底估算值
      const total = totalRef.current > 0 ? totalRef.current : TOTAL_ESTIMATE;
      setPct(Math.min(100, Math.round((bytesRef.current / total) * 100)));
    };
    // 累加每个文件的 Content-Length，作为进度条分母（gzip 后的真实传输大小）
    const addTotal = (n: number) => {
      totalRef.current += n;
      const total = totalRef.current > 0 ? totalRef.current : TOTAL_ESTIMATE;
      setPct(Math.min(100, Math.round((bytesRef.current / total) * 100)));
    };
    (async () => {
      try {
        // 两个包同时开拉：世界底图小、先回，先解码；亚洲包在解码期间继续下载。
        // 原来是「等下完一个再发下一个」，CPU 解码时带宽整段空转，白等好几秒。
        setStage('下载数据');
        const asiaFetch = fetchFieldPack({ ...ASIA, onBytes: addBytes, onTotal: addTotal });
        // 先接住可能的失败，免得 await 之前触发 unhandled rejection；真正抛错在下面
        asiaFetch.catch(() => {});

        const world = await decodeFieldPack(
          await fetchFieldPack({ ...WORLD, onBytes: addBytes, onTotal: addTotal }),
          (s) => !cancelled && setStage(`全球底图 · ${s}`),
        );
        if (cancelled) return;

        const asia = await decodeFieldPack(
          await asiaFetch,
          (s) => !cancelled && setStage(`亚洲高精网格 · ${s}`),
        );
        if (cancelled) return;

        setPacks({ asia, world });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setStage, setError]);

  return (
    <div className={`app ${activePanel ? '' : 'nopanel'}`}>
      {packs ? (
        <SceneView asia={packs.asia} world={packs.world} compassRef={compassRef} />
      ) : (
        <LoadingScreen stage={stage} error={error} mb={mb} pct={pct} />
      )}

      {packs && (
        <>
          <div className="vignette" />
          <TopBar />
          <WorkPanel />
          <Compass innerRef={compassRef} />
          <Hint mode={viewMode} />
          <Foot />
        </>
      )}
    </div>
  );
}
