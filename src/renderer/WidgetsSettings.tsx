import { useEffect, useState } from 'react';
import type { Widget } from '../preload';
import { BTN, BTN_DANGER, ROW } from './settingsStyles';

interface Props {
  onEdit: (uuid: string) => void;
  onDelete: (uuid: string) => void;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

export default function WidgetsSettings({ onEdit, onDelete }: Props) {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    void window.api.listWidgets().then(setWidgets);
  }, []);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  const handleDelete = (uuid: string) => {
    if (confirmingDelete === uuid) {
      onDelete(uuid);
      setWidgets((prev) => (prev ?? []).filter((w) => w.uuid !== uuid));
      setConfirmingDelete(null);
      return;
    }
    setConfirmingDelete(uuid);
  };

  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Widgets</h2>

      {widgets === null ? (
        <div style={{ padding: '16px 0', opacity: 0.7 }}>Loading…</div>
      ) : widgets.length === 0 ? (
        <div style={{ padding: '16px 0', opacity: 0.7 }}>No widgets yet.</div>
      ) : (
        <div>
          {widgets.map((w) => {
            const confirming = confirmingDelete === w.uuid;
            return (
              <div key={w.uuid} data-row style={ROW}>
                <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
                  <div
                    title={w.prompt}
                    style={{
                      fontSize: 14,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {w.summary?.name?.trim() || w.prompt || '(unnamed)'}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {formatDate(w.created_at)}
                    {w.pinned === true ? ' · pinned' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={BTN} onClick={() => onEdit(w.uuid)}>Edit</button>
                  <button
                    style={confirming ? { ...BTN_DANGER, borderColor: '#f85149' } : BTN_DANGER}
                    onClick={() => handleDelete(w.uuid)}
                  >
                    {confirming ? 'Click to confirm' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
