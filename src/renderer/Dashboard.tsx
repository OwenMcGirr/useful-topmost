import { useEffect, useState, useCallback } from 'react';
import Tile from './Tile';
import PromptModal from './PromptModal';
import type { Widget, TileState } from './types';

interface TileEntry {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
}

const PLUS_BUTTON: React.CSSProperties = {
  position: 'fixed',
  bottom: 32,
  right: 32,
  width: 64,
  height: 64,
  borderRadius: '50%',
  background: '#238636',
  color: '#fff',
  fontSize: 32,
  border: 0,
  cursor: 'pointer',
  zIndex: 50
};

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, 400px)',
  gap: 16,
  padding: 24,
  justifyContent: 'center'
};

export default function Dashboard() {
  const [tiles, setTiles] = useState<TileEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [repromptUuid, setRepromptUuid] = useState<string | null>(null);
  const [repromptInitial, setRepromptInitial] = useState('');

  // Initial load
  useEffect(() => {
    void (async () => {
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

  // Subscribe to widget:ready / widget:error
  useEffect(() => {
    const offReady = window.api.onWidgetReady(async (uuid) => {
      const htmlUrl = await window.api.htmlUrl(uuid);
      setTiles((prev) => {
        const oldTile = repromptUuid;
        let next = prev.map((t) => t.uuid === uuid ? { ...t, state: { kind: 'live' as const }, htmlUrl } : t);
        // Re-prompt completion: remove the old widget from the grid (folder is deleted below).
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
        if (wasRepromptNew) {
          // The new (reprompted) widget failed; keep the old, drop the placeholder.
          return prev.filter((t) => t.uuid !== uuid);
        }
        return prev.map((t) => t.uuid === uuid ? { ...t, state: { kind: 'error' as const, message: msg } } : t);
      });
      if (wasRepromptNew) {
        void window.api.deleteWidget(uuid); // also clean up the failed widget's folder
        setRepromptUuid(null);
      }
    });
    return () => { offReady(); offError(); };
  }, [repromptUuid]);

  const handleCreate = useCallback(async (prompt: string) => {
    setModalOpen(false);
    const { uuid } = await window.api.createWidget(prompt);
    setTiles((prev) => [...prev, {
      uuid, prompt, state: { kind: 'building' }, htmlUrl: ''
    }]);
  }, []);

  const handleDelete = useCallback(async (uuid: string) => {
    await window.api.deleteWidget(uuid);
    setTiles((prev) => prev.filter((t) => t.uuid !== uuid));
  }, []);

  const handleRetry = useCallback(async (uuid: string) => {
    const meta = await window.api.getWidgetMeta(uuid);
    // Delete the failed widget and recreate with the same prompt.
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
      // Start the new one; the old one is deleted in onWidgetReady when the new one is live.
      const { uuid } = await window.api.createWidget(prompt);
      setTiles((prev) => [...prev, {
        uuid, prompt, state: { kind: 'building' }, htmlUrl: ''
      }]);
    } else {
      await handleCreate(prompt);
    }
  }, [repromptUuid, handleCreate]);

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
            onRefresh={() => {}}
            onDismiss={() => handleDelete(t.uuid)}
            onReprompt={() => handleReprompt(t.uuid)}
            onRetry={() => handleRetry(t.uuid)}
          />
        ))}
      </div>
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
    </>
  );
}
