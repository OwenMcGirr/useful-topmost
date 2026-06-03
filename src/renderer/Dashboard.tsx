import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Tile from './Tile';
import SettingsModal from './SettingsModal';
import UpdatePrompt from './UpdatePrompt';
import WelcomeOverlay from './WelcomeOverlay';
import WidgetChatPanel from './WidgetChatPanel';
import type { Widget, TileState } from './types';
import type { UpdateState } from '../preload';
import {
  SHUFFLE_INTERVAL_MS,
  calculateDashboardFillLayout,
  calculateDashboardWeightCapacity,
  getDashboardPageCountByWeight,
  pickDashboardPageByWeight,
  pickVisibleDashboardTilesByWeight,
  type TileSize
} from './dashboard-grid';

interface TileEntry {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
  revision?: number;
  pinned?: boolean;
  size?: TileSize;
  selectedProviderIds?: string[];
  summary?: { sources: string[]; name?: string };
  refreshTtlMs?: number;
}

const SIZE_CYCLE: Record<TileSize, TileSize> = {
  small: 'wide',
  wide: 'large',
  large: 'small'
};

type ChatState =
  | { open: false }
  | { open: true; mode: 'create'; initialMessage?: string }
  | { open: true; mode: 'edit'; widget: { uuid: string; prompt: string; htmlUrl?: string; selectedProviderIds?: string[]; refreshTtlMs?: number }; initialMessage?: string };

const CONTROLS_REVEAL_ZONE: React.CSSProperties = {
  position: 'fixed',
  right: 0,
  bottom: 0,
  width: 420,
  maxWidth: '100vw',
  height: 136,
  zIndex: 50,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'flex-end',
  padding: 16
};

const CONTROLS_DOCK_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 8,
  borderRadius: 8,
  border: '1px solid rgba(240, 246, 252, 0.14)',
  background: 'rgba(13, 17, 23, 0.74)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.34)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  transition: 'opacity 160ms ease, transform 160ms ease'
};

const DOCK_ICON_BUTTON: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 22,
  background: '#21262d', color: '#e6edf3', fontSize: 18,
  border: '1px solid #30363d',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
};

const PAGER_COUNT: React.CSSProperties = {
  color: '#8b949e', fontSize: 12, padding: '0 4px'
};

const DOCK_PRIMARY_BUTTON: React.CSSProperties = {
  ...DOCK_ICON_BUTTON,
  width: 52,
  height: 52,
  borderRadius: 26,
  background: '#238636',
  borderColor: '#238636',
  color: '#fff',
  fontSize: 30
};

const DOCK_TEXT_BUTTON: React.CSSProperties = {
  height: 44, padding: '0 14px', borderRadius: 22,
  background: '#21262d', color: '#e6edf3', fontSize: 14,
  border: '1px solid #30363d', cursor: 'pointer'
};

const EMPTY_HINT: React.CSSProperties = {
  position: 'fixed', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#6e7681', fontSize: 14, pointerEvents: 'none'
};

function cacheBust(url: string): { htmlUrl: string; revision: number } {
  const revision = Date.now();
  return {
    htmlUrl: `${url}${url.includes('?') ? '&' : '?'}rev=${revision}`,
    revision
  };
}

export default function Dashboard() {
  const [tiles, setTiles] = useState<TileEntry[]>([]);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chat, setChat] = useState<ChatState>({ open: false });
  const [widgetPreload, setWidgetPreload] = useState<string>('');
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [geekMode, setGeekMode] = useState(false);
  const [addProviderSeedQuery, setAddProviderSeedQuery] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const editBuilds = useRef<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement | null>(null);
  const controlsHideTimer = useRef<number | null>(null);

  const capacityWeight = useMemo(() => {
    const width = gridSize.width || window.innerWidth || 1;
    const height = gridSize.height || window.innerHeight || 1;
    return calculateDashboardWeightCapacity(width, height);
  }, [gridSize.height, gridSize.width]);

  const gridStyle = useMemo<React.CSSProperties>(() => ({
    position: 'relative',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden'
  }), []);

  const tileSelectionKey = useMemo(
    () => tiles.map((tile) => `${tile.uuid}:${tile.pinned === true ? '1' : '0'}`).join('|'),
    [tiles]
  );

  useEffect(() => {
    void window.api.onboarding.get().then((s) => setOnboardingDismissed(s.dismissed));
  }, []);

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimer.current !== null) {
      window.clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsHideTimer();
    controlsHideTimer.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsHideTimer.current = null;
    }, 1800);
  }, [clearControlsHideTimer]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  useEffect(() => {
    scheduleControlsHide();
    return clearControlsHideTimer;
  }, [clearControlsHideTimer, scheduleControlsHide]);

  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;

    const updateSize = () => {
      setGridSize({
        width: node.clientWidth || window.innerWidth,
        height: node.clientHeight || window.innerHeight
      });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setGridSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void window.api.updates.getState().then(setUpdateState);
    return window.api.updates.onState(setUpdateState);
  }, []);

  const refreshGeekMode = useCallback(async () => {
    const prefs = await window.api.prefs.get();
    setGeekMode(prefs.geekMode);
  }, []);

  useEffect(() => {
    void refreshGeekMode();
  }, [refreshGeekMode]);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (chat.open) {
          setChat({ open: false });
          e.preventDefault();
        } else if (settingsOpen) {
          setSettingsOpen(false);
          e.preventDefault();
        }
        return;
      }
      if (e.ctrlKey && e.key === ',') {
        setSettingsOpen(true);
        e.preventDefault();
        return;
      }
      if (isTyping()) return;
      if (e.key === 'n' || e.key === 'N') {
        if (!chat.open && !settingsOpen) {
          setChat({ open: true, mode: 'create' });
          e.preventDefault();
        }
        return;
      }
      if (e.key === '/') {
        if (chat.open) {
          const textarea = document.querySelector<HTMLTextAreaElement>('aside[aria-label="Widget chat"] textarea');
          textarea?.focus();
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chat.open, settingsOpen]);

  useEffect(() => {
    void (async () => {
      const url = await window.api.widgetPreloadUrl();
      setWidgetPreload(url);
      const widgets: Widget[] = await window.api.listWidgets();
      const entries: TileEntry[] = await Promise.all(widgets.map(async (w) => ({
        uuid: w.uuid,
        prompt: w.prompt,
        state: { kind: 'live' as const },
        htmlUrl: await window.api.htmlUrl(w.uuid),
        revision: 0,
        pinned: w.pinned === true,
        size: w.size,
        selectedProviderIds: w.selectedProviderIds,
        summary: w.summary,
        refreshTtlMs: w.refreshTtlMs
      })));
      setTiles(entries);
    })();
  }, []);

  useEffect(() => {
    const offReady = window.api.onWidgetReady(async (uuid) => {
      const url = await window.api.htmlUrl(uuid);
      const busted = cacheBust(url);
      let summary: { sources: string[] } | undefined;
      try {
        const meta = await window.api.getWidgetMeta(uuid);
        summary = (meta as any).summary;
      } catch { /* ignore */ }
      setTiles((prev) => prev.map((t) => t.uuid === uuid
        ? { ...t, state: { kind: 'live' as const }, ...busted, summary: summary ?? t.summary }
        : t));
      editBuilds.current.delete(uuid);
    });
    const offError = window.api.onWidgetError((uuid, msg) => {
      if (editBuilds.current.has(uuid)) {
        editBuilds.current.delete(uuid);
        return;
      }
      setTiles((prev) => prev.map((t) => t.uuid === uuid
        ? { ...t, state: { kind: 'error' as const, message: msg } }
        : t));
    });
    return () => { offReady(); offError(); };
  }, []);

  const handleDelete = useCallback(async (uuid: string) => {
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
  }, []);

  const handleCancel = useCallback(async (uuid: string) => {
    await window.api.cancelWidget(uuid);
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
  }, []);

  const handleRetry = useCallback(async (uuid: string) => {
    const tile = tiles.find((t) => t.uuid === uuid);
    const previousSelection = tile?.selectedProviderIds;
    const previousRefreshTtlMs = tile?.refreshTtlMs;
    const meta = await window.api.getWidgetMeta(uuid);
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
    const created = await window.api.chatStartWidget(meta.prompt, previousSelection, previousRefreshTtlMs);
    if (tile?.pinned) {
      await window.api.setWidgetPinned(created.uuid, true);
    }
    setTiles((prev) => [...prev, {
      uuid: created.uuid,
      prompt: meta.prompt,
      state: { kind: 'building' },
      htmlUrl: '',
      revision: 0,
      pinned: tile?.pinned === true,
      selectedProviderIds: previousSelection,
      refreshTtlMs: previousRefreshTtlMs
    }]);
  }, [tiles]);

  const handleEditChat = useCallback((tile: TileEntry) => {
    setChat({
      open: true,
      mode: 'edit',
      widget: {
        uuid: tile.uuid,
        prompt: tile.prompt,
        htmlUrl: tile.htmlUrl,
        selectedProviderIds: tile.selectedProviderIds,
        refreshTtlMs: tile.refreshTtlMs
      }
    });
  }, []);

  const handleChatCreated = useCallback((uuid: string, prompt: string, selectedProviderIds: string[] | undefined, refreshTtlMs: number) => {
    setTiles((prev) => [...prev, {
      uuid, prompt, state: { kind: 'building' }, htmlUrl: '', revision: 0, pinned: false,
      selectedProviderIds,
      refreshTtlMs
    }]);
    setChat({ open: true, mode: 'edit', widget: { uuid, prompt, selectedProviderIds, refreshTtlMs } });
  }, []);

  const handleChatSent = useCallback((uuid: string, prompt: string) => {
    editBuilds.current.add(uuid);
    setTiles((prev) => prev.map((t) => t.uuid === uuid ? { ...t, prompt } : t));
  }, []);

  const handleRefreshChanged = useCallback((uuid: string, refreshTtlMs: number) => {
    setTiles((prev) => prev.map((t) => t.uuid === uuid ? { ...t, refreshTtlMs } : t));
    setChat((current) => current.open && current.mode === 'edit' && current.widget.uuid === uuid
      ? { ...current, widget: { ...current.widget, refreshTtlMs } }
      : current
    );
  }, []);

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    void window.api.onboarding.dismiss();
  }, []);

  const handleUseExample = useCallback((prompt: string) => {
    dismissOnboarding();
    setChat({ open: true, mode: 'create', initialMessage: prompt });
  }, [dismissOnboarding]);

  const handleCycleSize = useCallback(async (uuid: string) => {
    const tile = tiles.find((t) => t.uuid === uuid);
    if (!tile) return;

    const previousSize: TileSize = tile.size ?? 'small';
    const nextSize: TileSize = SIZE_CYCLE[previousSize];
    setTiles((prev) => prev.map((t) => t.uuid === uuid ? { ...t, size: nextSize } : t));

    try {
      await window.api.setWidgetSize(uuid, nextSize);
    } catch {
      setTiles((prev) => prev.map((t) => t.uuid === uuid ? { ...t, size: previousSize } : t));
    }
  }, [tiles]);

  const handleTogglePinned = useCallback(async (uuid: string) => {
    const tile = tiles.find((t) => t.uuid === uuid);
    if (!tile) return;

    const previousPinned = tile.pinned === true;
    const nextPinned = !previousPinned;
    setTiles((prev) => prev.map((t) => t.uuid === uuid ? { ...t, pinned: nextPinned } : t));

    try {
      await window.api.setWidgetPinned(uuid, nextPinned);
    } catch {
      setTiles((prev) => prev.map((t) => t.uuid === uuid ? { ...t, pinned: previousPinned } : t));
    }
  }, [tiles]);

  const shuffleVisibleTiles = useCallback(() => {
    setPageIndex(null);
    setVisibleIds((previousIds) => {
      if (getDashboardPageCountByWeight(tiles, capacityWeight) <= 1) {
        return tiles.map((tile) => tile.uuid);
      }

      const previousTiles = previousIds
        .map((id) => tiles.find((tile) => tile.uuid === id))
        .filter((tile): tile is TileEntry => Boolean(tile));

      return pickVisibleDashboardTilesByWeight(tiles, capacityWeight, previousTiles).map((tile) => tile.uuid);
    });
  }, [capacityWeight, tiles]);

  const pageCount = useMemo(() => {
    return getDashboardPageCountByWeight(tiles, capacityWeight);
  }, [capacityWeight, tiles]);

  const stepPage = useCallback((delta: number) => {
    setPageIndex((current) => {
      const base = current ?? 0;
      return ((base + delta) % pageCount + pageCount) % pageCount;
    });
  }, [pageCount]);

  useEffect(() => {
    if (pageIndex !== null) {
      setVisibleIds(pickDashboardPageByWeight(tiles, capacityWeight, pageIndex).map((tile) => tile.uuid));
      return;
    }
    setVisibleIds(() => {
      if (pageCount <= 1) return tiles.map((tile) => tile.uuid);

      return pickDashboardPageByWeight(tiles, capacityWeight, 0).map((tile) => tile.uuid);
    });
  }, [capacityWeight, pageCount, tileSelectionKey, tiles, pageIndex]);

  useEffect(() => {
    if (pageCount <= 1 || pageIndex !== null) return;
    const interval = window.setInterval(shuffleVisibleTiles, SHUFFLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [pageCount, shuffleVisibleTiles, pageIndex]);

  const visibleTiles = useMemo(() => {
    if (pageCount <= 1) return tiles;

    return visibleIds
      .map((id) => tiles.find((tile) => tile.uuid === id))
      .filter((tile): tile is TileEntry => Boolean(tile));
  }, [pageCount, tiles, visibleIds]);

  const showWelcome = tiles.length === 0 && onboardingDismissed === false;
  const showPassiveHint = tiles.length === 0 && onboardingDismissed === true;
  const showShuffle = pageCount > 1;
  const layout = useMemo(() => {
    const width = gridSize.width || window.innerWidth || 1;
    const height = gridSize.height || window.innerHeight || 1;
    return calculateDashboardFillLayout(width, height, visibleTiles);
  }, [gridSize.height, gridSize.width, visibleTiles]);
  const tileRects = useMemo(() => new Map(layout.rects.map((rect) => [rect.uuid, rect])), [layout.rects]);

  return (
    <>
      <div ref={gridRef} style={gridStyle}>
        <AnimatePresence mode="popLayout">
          {visibleTiles.map((t) => (
            <motion.div
              key={`${t.uuid}-${t.revision ?? 0}`}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              data-dashboard-tile={t.uuid}
              style={{
                position: 'absolute',
                left: tileRects.get(t.uuid)?.left ?? 0,
                top: tileRects.get(t.uuid)?.top ?? 0,
                width: tileRects.get(t.uuid)?.width ?? 1,
                height: tileRects.get(t.uuid)?.height ?? 1
              }}
            >
              <Tile
                uuid={t.uuid}
                prompt={t.prompt}
                state={t.state}
                htmlUrl={t.htmlUrl}
                widgetPreloadUrl={widgetPreload}
                pinned={t.pinned}
                size={t.size}
                geekMode={geekMode}
                summary={t.summary}
                refreshTtlMs={t.refreshTtlMs}
                onRefresh={() => {}}
                onDismiss={() => handleDelete(t.uuid)}
                onEditChat={() => handleEditChat(t)}
                onTogglePinned={() => handleTogglePinned(t.uuid)}
                onCycleSize={() => handleCycleSize(t.uuid)}
                onCancel={() => handleCancel(t.uuid)}
                onRetry={() => handleRetry(t.uuid)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div
        role="group"
        aria-label="Dashboard controls"
        style={CONTROLS_REVEAL_ZONE}
        onPointerEnter={revealControls}
        onPointerMove={revealControls}
        onFocus={revealControls}
        onBlur={scheduleControlsHide}
      >
        <div
          data-visible={controlsVisible ? 'true' : 'false'}
          style={{
            ...CONTROLS_DOCK_BASE,
            opacity: controlsVisible ? 1 : 0,
            transform: controlsVisible ? 'translateY(0)' : 'translateY(10px)',
            pointerEvents: controlsVisible ? 'auto' : 'none'
          }}
        >
          {showShuffle && (
            <>
              <span style={PAGER_COUNT} aria-label="Visible widgets">
                {visibleTiles.length} of {tiles.length}
              </span>
              <button aria-label="Previous page" title="Previous page" style={DOCK_ICON_BUTTON} onClick={() => stepPage(-1)}>‹</button>
              <button aria-label="Next page" title="Next page" style={DOCK_ICON_BUTTON} onClick={() => stepPage(1)}>›</button>
              <button aria-label="Shuffle widgets" title="Shuffle visible widgets" style={DOCK_TEXT_BUTTON} onClick={shuffleVisibleTiles}>Shuffle</button>
            </>
          )}
          <button aria-label="Settings" title="Settings" style={DOCK_ICON_BUTTON} onClick={() => setSettingsOpen(true)}>⚙</button>
          <button aria-label="New widget" title="New widget" style={DOCK_PRIMARY_BUTTON} onClick={() => setChat({ open: true, mode: 'create' })}>+</button>
        </div>
      </div>
      <WidgetChatPanel
        open={chat.open}
        mode={chat.open ? chat.mode : 'create'}
        widget={chat.open && chat.mode === 'edit' ? chat.widget : undefined}
        initialMessage={chat.open ? chat.initialMessage : undefined}
        widgetPreloadUrl={widgetPreload}
        onClose={() => setChat({ open: false })}
        onDeleted={(uuid) => setTiles((prev) => prev.filter((t) => t.uuid !== uuid))}
        onCreated={handleChatCreated}
        onSent={handleChatSent}
        onRefreshChanged={handleRefreshChanged}
        onAddProviderRequest={(name) => { setAddProviderSeedQuery(name); setSettingsOpen(true); }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); void refreshGeekMode(); }}
        updateState={updateState}
        onCheckUpdates={() => void window.api.updates.checkNow().then(setUpdateState)}
        onRestartUpdate={() => void window.api.updates.restart()}
        onEditWidget={(uuid) => {
          const tile = tiles.find((t) => t.uuid === uuid);
          if (!tile) return;
          setSettingsOpen(false);
          handleEditChat(tile);
        }}
        onDeleteWidget={(uuid) => void handleDelete(uuid)}
        addProviderSeedQuery={addProviderSeedQuery}
        onAddProviderConsumed={() => setAddProviderSeedQuery(null)}
      />
      <UpdatePrompt state={updateState} />
      {showWelcome && (
        <WelcomeOverlay onDismiss={dismissOnboarding} onUseExample={handleUseExample} />
      )}
      {showPassiveHint && (
        <div style={EMPTY_HINT}>No widgets yet. Click + to add one.</div>
      )}
    </>
  );
}

