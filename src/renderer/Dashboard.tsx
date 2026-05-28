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
  DASHBOARD_PADDING,
  SHUFFLE_INTERVAL_MS,
  TILE_GAP,
  calculateDashboardCapacity,
  pickDashboardPage,
  pickVisibleDashboardTiles
} from './dashboard-grid';

type TileSize = 'small' | 'wide' | 'large';

interface TileEntry {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
  revision?: number;
  pinned?: boolean;
  size?: TileSize;
  selectedProviderIds?: string[];
  summary?: { sources: string[] };
  refreshTtlMs?: number;
}

const SIZE_CYCLE: Record<TileSize, TileSize> = {
  small: 'wide',
  wide: 'large',
  large: 'small'
};

function gridSpan(size: TileSize | undefined): React.CSSProperties {
  switch (size) {
    case 'wide': return { gridColumn: 'span 2' };
    case 'large': return { gridColumn: 'span 2', gridRow: 'span 2' };
    default: return {};
  }
}

type ChatState =
  | { open: false }
  | { open: true; mode: 'create'; initialMessage?: string }
  | { open: true; mode: 'edit'; widget: { uuid: string; prompt: string; htmlUrl?: string; selectedProviderIds?: string[]; refreshTtlMs?: number }; initialMessage?: string };

const PLUS_BUTTON: React.CSSProperties = {
  position: 'fixed', bottom: 32, right: 32,
  width: 64, height: 64, borderRadius: '50%',
  background: '#238636', color: '#fff', fontSize: 32,
  border: 0, cursor: 'pointer', zIndex: 50
};

const GEAR_BUTTON: React.CSSProperties = {
  position: 'fixed', bottom: 32, right: 112,
  width: 48, height: 48, borderRadius: '50%',
  background: '#21262d', color: '#e6edf3', fontSize: 20,
  border: '1px solid #30363d', cursor: 'pointer', zIndex: 50
};

const PAGER_BUTTON: React.CSSProperties = {
  height: 48, width: 48, padding: 0, borderRadius: 24,
  background: '#21262d', color: '#e6edf3', fontSize: 18,
  border: '1px solid #30363d', cursor: 'pointer'
};

const PAGER_BAR: React.CSSProperties = {
  position: 'fixed', bottom: 32, right: 176,
  display: 'flex', alignItems: 'center', gap: 8, zIndex: 50
};

const PAGER_COUNT: React.CSSProperties = {
  color: '#8b949e', fontSize: 12, padding: '0 4px'
};

const SHUFFLE_BUTTON: React.CSSProperties = {
  height: 48, padding: '0 16px', borderRadius: 24,
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
  const editBuilds = useRef<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement | null>(null);

  const { columns, capacity } = useMemo(() => {
    const width = gridSize.width || window.innerWidth || 1;
    const height = gridSize.height || window.innerHeight || 1;
    return calculateDashboardCapacity(width, height);
  }, [gridSize.height, gridSize.width]);

  const gridStyle = useMemo<React.CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 400px)`,
    gridAutoRows: '300px',
    gap: TILE_GAP,
    padding: DASHBOARD_PADDING,
    justifyContent: 'center',
    alignContent: 'center',
    height: '100vh',
    overflow: 'hidden'
  }), [columns]);

  const tileSelectionKey = useMemo(
    () => tiles.map((tile) => `${tile.uuid}:${tile.pinned === true ? '1' : '0'}`).join('|'),
    [tiles]
  );

  useEffect(() => {
    void window.api.onboarding.get().then((s) => setOnboardingDismissed(s.dismissed));
  }, []);

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
      if (tiles.length <= capacity) return tiles.map((tile) => tile.uuid);

      const previousTiles = previousIds
        .map((id) => tiles.find((tile) => tile.uuid === id))
        .filter((tile): tile is TileEntry => Boolean(tile));

      return pickVisibleDashboardTiles(tiles, capacity, previousTiles).map((tile) => tile.uuid);
    });
  }, [capacity, tiles]);

  const pageCount = useMemo(() => {
    if (tiles.length <= capacity) return 1;
    const pinnedCount = tiles.filter((tile) => tile.pinned === true).length;
    if (pinnedCount >= capacity) return 1;
    const unpinnedCount = tiles.length - pinnedCount;
    const slots = capacity - pinnedCount;
    return Math.max(1, Math.ceil(unpinnedCount / slots));
  }, [capacity, tiles]);

  const stepPage = useCallback((delta: number) => {
    setPageIndex((current) => {
      const base = current ?? 0;
      return ((base + delta) % pageCount + pageCount) % pageCount;
    });
  }, [pageCount]);

  useEffect(() => {
    if (pageIndex !== null) {
      setVisibleIds(pickDashboardPage(tiles, capacity, pageIndex).map((tile) => tile.uuid));
      return;
    }
    setVisibleIds((previousIds) => {
      if (tiles.length <= capacity) return tiles.map((tile) => tile.uuid);

      const currentVisibleTiles = previousIds
        .map((id) => tiles.find((tile) => tile.uuid === id))
        .filter((tile): tile is TileEntry => Boolean(tile));

      return pickVisibleDashboardTiles(tiles, capacity, currentVisibleTiles).map((tile) => tile.uuid);
    });
  }, [capacity, tileSelectionKey, tiles, pageIndex]);

  useEffect(() => {
    if (tiles.length <= capacity || pageIndex !== null) return;
    const interval = window.setInterval(shuffleVisibleTiles, SHUFFLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [capacity, shuffleVisibleTiles, tiles.length, pageIndex]);

  const visibleTiles = useMemo(() => {
    if (tiles.length <= capacity) return tiles;

    return visibleIds
      .map((id) => tiles.find((tile) => tile.uuid === id))
      .filter((tile): tile is TileEntry => Boolean(tile));
  }, [capacity, tiles, visibleIds]);

  const showWelcome = tiles.length === 0 && onboardingDismissed === false;
  const showPassiveHint = tiles.length === 0 && onboardingDismissed === true;
  const showShuffle = tiles.length > capacity;

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
              style={gridSpan(t.size)}
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
      {showShuffle && (
        <div style={PAGER_BAR}>
          <span style={PAGER_COUNT} aria-label="visible widgets">
            {visibleTiles.length} of {tiles.length}
          </span>
          <button aria-label="previous page" title="Previous page" style={PAGER_BUTTON} onClick={() => stepPage(-1)}>‹</button>
          <button aria-label="next page" title="Next page" style={PAGER_BUTTON} onClick={() => stepPage(1)}>›</button>
          <button aria-label="shuffle widgets" title="Shuffle visible widgets" style={SHUFFLE_BUTTON} onClick={shuffleVisibleTiles}>shuffle</button>
        </div>
      )}
      <button aria-label="settings" title="Settings" style={GEAR_BUTTON} onClick={() => setSettingsOpen(true)}>⚙</button>
      <button aria-label="new widget" title="New widget" style={PLUS_BUTTON} onClick={() => setChat({ open: true, mode: 'create' })}>+</button>
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
