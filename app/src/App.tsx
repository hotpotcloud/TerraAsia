import { useEffect, useRef, useState } from 'react';
import { loadFieldPack, type FieldPack } from './data/terrainLoader';
import { SceneView } from './scene/SceneView';
import { Compass, Foot, Hint, LoadingScreen, SideToggle, TitleCard } from './ui/Chrome';
import { SidePanel } from './ui/SidePanel';
import { useAppStore } from './state/store';

const BASE = `${import.meta.env.BASE_URL}data/`;

interface Packs {
  asia: FieldPack;
  world: FieldPack;
}

export default function App() {
  const [packs, setPacks] = useState<Packs | null>(null);
  const stage = useAppStore((s) => s.stage);
  const error = useAppStore((s) => s.error);
  const setStage = useAppStore((s) => s.setStage);
  const setError = useAppStore((s) => s.setError);
  const sideOpen = useAppStore((s) => s.sideOpen);
  const viewMode = useAppStore((s) => s.viewMode);
  const compassRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 先用粗底图把球面铺满，再加载亚洲高精网格：首屏更快出画面
        setStage('全球底图');
        const world = await loadFieldPack({
          metaUrl: `${BASE}world.json`,
          pngUrl: `${BASE}world.png`,
          maskUrl: `${BASE}world_mask.png`,
          onStage: (s) => !cancelled && setStage(`全球底图 · ${s}`),
        });
        if (cancelled) return;

        setStage('亚洲高精网格');
        const asia = await loadFieldPack({
          jsonUrl: `${BASE}data.json`,
          pngUrl: `${BASE}terrain.png`,
          maskUrl: `${BASE}mask.png`,
          onStage: (s) => !cancelled && setStage(`亚洲高精网格 · ${s}`),
        });
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
    <div className={`app ${sideOpen ? '' : 'nopanel'}`}>
      {packs ? (
        <SceneView asia={packs.asia} world={packs.world} compassRef={compassRef} />
      ) : (
        <LoadingScreen stage={stage} error={error} />
      )}

      {packs && (
        <>
          <div className="vignette" />
          <TitleCard />
          <SideToggle />
          {sideOpen && <SidePanel />}
          <Compass innerRef={compassRef} />
          <Hint mode={viewMode} />
          <Foot />
        </>
      )}
    </div>
  );
}
