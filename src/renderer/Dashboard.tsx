import { useEffect, useState, useCallback } from 'react';
import Tile from './Tile';
import PromptModal from './PromptModal';
import SecretsModal from './SecretsModal';
import UpdatePrompt from './UpdatePrompt';
import WelcomeOverlay from './WelcomeOverlay';
import type { Widget, TileState } from './types';
import type { UpdateState } from '../preload';

interface TileEntry {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
}

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

export default function Dashboard() {
  const [tiles, setTiles] = useState<TileEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repromptUuid, setRepromptUuid] = useState<string | null>(null);
  const [repromptInitial, setRepromptInitial] = useState('');
  const [widgetPreload, setWidgetPreload] = useState<string>('');
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    void window.api.onboarding.get().then((s) => setOnboardingDismissed(s.dismissed));
  }, []);

  useEffect(() => {
    void window.api.updates.getState().then(setUpdateState);
    return window.api.updates.onState(setUpdateState);
  }, []);

  useEffect(() => {
    // Fetch the widget preload URL BEFORE restoring tiles. Electron reads the
    // <webview preload> attribute at navigation time, so if a tile mounts
    // with preload="" it loads without window.appFetch — and a later attribute
    // update won't retroactively re-inject it. Sequencing both calls in one
    // effect guarantees widgetPreload is set before any live tile renders.
    void (async () => {
      const url = await window.api.widgetPreloadUrl();
      setWidgetPreload(url);
      const widgets: Widget[] = await window.api.listWidgets();
      const entries: TileEntry[] = await Promise.all(widgets.map(async (w) => ({
        uuid: w.uuid,
        prompt: w.prompt,
        state: { kind: 'live' as const },
        htmlUrl: await window.api.htmlUrl(w.uuid)
      })));
      setTiles(entries);
    })();
  }, []);

  useEffect(() => {
    const offReady = window.api.onWidgetReady(async (uuid) => {
      const htmlUrl = await window.api.htmlUrl(uuid);
      setTiles((prev) => {
        const oldTile = repromptUuid;
        let next = prev.map((t) => t.uuid === uuid ? { ...t, state: { kind: 'live' as const }, htmlUrl } : t);
        if (oldTile && oldTile !== uuid) {
          next = next.filter((t) => t.uuid !== oldTile);
          void window.api.deleteWidget(oldTile);
        }
        return next;
      });
      if (repromptUuid && repromptUuid !== uuid) setRepromptUuid(null);
    });
    const offError = window.api.onWidgetError((uuid, msg) => {
      const wasRepromptNew = repromptUuid && uuid !== repromptUuid;
      setTiles((prev) => {
        if (wasRepromptNew) return prev.filter((t) => t.uuid !== uuid);
        return prev.map((t) => t.uuid === uuid ? { ...t, state: { kind: 'error' as const, message: msg } } : t);
      });
      if (wasRepromptNew) {
        void window.api.deleteWidget(uuid);
        setRepromptUuid(null);
      }
    });
    return () => { offReady(); offError(); };
  }, [repromptUuid]);

  const handleCreate = useCallback(async (prompt: string) => {
    setModalOpen(false);
    const { uuid } = await window.api.createWidget(prompt);
    setTiles((prev) => [...prev, { uuid, prompt, state: { kind: 'building' }, htmlUrl: '' }]);
  }, []);

  const handleDelete = useCallback(async (uuid: string) => {
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
  }, []);

  const handleRetry = useCallback(async (uuid: string) => {
    const meta = await window.api.getWidgetMeta(uuid);
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
    const created = await window.api.createWidget(meta.prompt);
    setTiles((prev) => [...prev, {
      uuid: created.uuid, prompt: meta.prompt, state: { kind: 'building' }, htmlUrl: ''
    }]);
  }, []);

  const handleReprompt = useCallback(async (uuid: string) => {
    const meta = await window.api.getWidgetMeta(uuid);
    setRepromptUuid(uuid);
    setRepromptInitial(meta.prompt);
    setModalOpen(true);
  }, []);

  const handleModalSubmit = useCallback(async (prompt: string) => {
    setModalOpen(false);
    if (repromptUuid) {
      const { uuid } = await window.api.createWidget(prompt);
      setTiles((prev) => [...prev, { uuid, prompt, state: { kind: 'building' }, htmlUrl: '' }]);
    } else {
      await handleCreate(prompt);
    }
  }, [repromptUuid, handleCreate]);

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    void window.api.onboarding.dismiss();
  }, []);

  const handleUseExample = useCallback((prompt: string) => {
    dismissOnboarding();
    setRepromptUuid(null);
    setRepromptInitial(prompt);
    setModalOpen(true);
  }, [dismissOnboarding]);

  const showWelcome = tiles.length === 0 && onboardingDismissed === false;
  const showPassiveHint = tiles.length === 0 && onboardingDismissed === true;

  return (
    <>
      <div style={GRID}>
        {tiles.map((t) => (
          <Tile
            key={t.uuid}
            uuid={t.uuid}
            prompt={t.prompt}
            state={t.state}
            htmlUrl={t.htmlUrl}
            widgetPreloadUrl={widgetPreload}
            onRefresh={() => {}}
            onDismiss={() => handleDelete(t.uuid)}
            onReprompt={() => handleReprompt(t.uuid)}
            onRetry={() => handleRetry(t.uuid)}
          />
        ))}
      </div>
      <button aria-label="settings" style={GEAR_BUTTON} onClick={() => setSettingsOpen(true)}>⚙</button>
      <button style={PLUS_BUTTON} onClick={() => {
        setRepromptUuid(null);
        setRepromptInitial('');
        setModalOpen(true);
      }}>+</button>
      <PromptModal
        open={modalOpen}
        initialValue={repromptInitial}
        onSubmit={handleModalSubmit}
        onClose={() => {
          setModalOpen(false);
          setRepromptUuid(null);
        }}
      />
      <SecretsModal
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
