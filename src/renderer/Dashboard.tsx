import { useEffect, useRef, useState, useCallback } from 'react';
import Tile from './Tile';
import SettingsModal from './SettingsModal';
import UpdatePrompt from './UpdatePrompt';
import WelcomeOverlay from './WelcomeOverlay';
import WidgetChatPanel from './WidgetChatPanel';
import type { Widget, TileState } from './types';
import type { UpdateState } from '../preload';

interface TileEntry {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
  revision?: number;
}

type ChatState =
  | { open: false }
  | { open: true; mode: 'create'; initialMessage?: string }
  | { open: true; mode: 'edit'; widget: { uuid: string; prompt: string; htmlUrl?: string }; initialMessage?: string };

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

const GRID: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, 400px)',
  gap: 16, padding: 24, justifyContent: 'center'
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chat, setChat] = useState<ChatState>({ open: false });
  const [widgetPreload, setWidgetPreload] = useState<string>('');
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const editBuilds = useRef<Set<string>>(new Set());

  useEffect(() => {
    void window.api.onboarding.get().then((s) => setOnboardingDismissed(s.dismissed));
  }, []);

  useEffect(() => {
    void window.api.updates.getState().then(setUpdateState);
    return window.api.updates.onState(setUpdateState);
  }, []);

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
        revision: 0
      })));
      setTiles(entries);
    })();
  }, []);

  useEffect(() => {
    const offReady = window.api.onWidgetReady(async (uuid) => {
      const url = await window.api.htmlUrl(uuid);
      const busted = cacheBust(url);
      setTiles((prev) => prev.map((t) => t.uuid === uuid
        ? { ...t, state: { kind: 'live' as const }, ...busted }
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

  const handleRetry = useCallback(async (uuid: string) => {
    const meta = await window.api.getWidgetMeta(uuid);
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
    const created = await window.api.chatStartWidget(meta.prompt);
    setTiles((prev) => [...prev, {
      uuid: created.uuid, prompt: meta.prompt, state: { kind: 'building' }, htmlUrl: '', revision: 0
    }]);
  }, []);

  const handleEditChat = useCallback((tile: TileEntry) => {
    setChat({
      open: true,
      mode: 'edit',
      widget: { uuid: tile.uuid, prompt: tile.prompt, htmlUrl: tile.htmlUrl }
    });
  }, []);

  const handleChatCreated = useCallback((uuid: string, prompt: string) => {
    setTiles((prev) => [...prev, { uuid, prompt, state: { kind: 'building' }, htmlUrl: '', revision: 0 }]);
    setChat({ open: true, mode: 'edit', widget: { uuid, prompt } });
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

  const showWelcome = tiles.length === 0 && onboardingDismissed === false;
  const showPassiveHint = tiles.length === 0 && onboardingDismissed === true;

  return (
    <>
      <div style={GRID}>
        {tiles.map((t) => (
          <Tile
            key={`${t.uuid}-${t.revision ?? 0}`}
            uuid={t.uuid}
            prompt={t.prompt}
            state={t.state}
            htmlUrl={t.htmlUrl}
            widgetPreloadUrl={widgetPreload}
            onRefresh={() => {}}
            onDismiss={() => handleDelete(t.uuid)}
            onEditChat={() => handleEditChat(t)}
            onRetry={() => handleRetry(t.uuid)}
          />
        ))}
      </div>
      <button aria-label="settings" style={GEAR_BUTTON} onClick={() => setSettingsOpen(true)}>⚙</button>
      <button style={PLUS_BUTTON} onClick={() => setChat({ open: true, mode: 'create' })}>+</button>
      <WidgetChatPanel
        open={chat.open}
        mode={chat.open ? chat.mode : 'create'}
        widget={chat.open && chat.mode === 'edit' ? chat.widget : undefined}
        initialMessage={chat.open ? chat.initialMessage : undefined}
        widgetPreloadUrl={widgetPreload}
        onClose={() => setChat({ open: false })}
        onCreated={handleChatCreated}
        onSent={handleChatSent}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        updateState={updateState}
        onCheckUpdates={() => void window.api.updates.checkNow().then(setUpdateState)}
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
