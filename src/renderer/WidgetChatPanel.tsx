import { useEffect, useMemo, useState } from 'react';
import type { WidgetChatMessage } from '../preload';
import type { PublicProvider } from '../main/secrets-store';

interface WidgetChatPanelProps {
  open: boolean;
  mode: 'create' | 'edit';
  widget?: {
    uuid: string;
    prompt: string;
    htmlUrl?: string;
    selectedProviderIds?: string[];
  };
  initialMessage?: string;
  widgetPreloadUrl: string;
  onClose: () => void;
  onCreated: (uuid: string, prompt: string, selectedProviderIds: string[] | undefined) => void;
  onSent: (uuid: string, prompt: string) => void;
  onDeleted: (uuid: string) => void;
}

const SCRIM: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.3)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  zIndex: 79,
  pointerEvents: 'none'
};

const PANEL: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 440,
  maxWidth: '100vw',
  background: '#161b22',
  color: '#e6edf3',
  borderLeft: '1px solid #30363d',
  zIndex: 80,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-16px 0 32px rgba(0,0,0,0.28)'
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid #21262d'
};

const PREVIEW: React.CSSProperties = {
  width: 400,
  height: 300,
  margin: '16px auto 0',
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 6,
  overflow: 'hidden',
  display: 'grid',
  placeItems: 'center',
  color: '#8b949e',
  fontSize: 13
};

const TRANSCRIPT: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10
};

const PROVIDERS_BOX: React.CSSProperties = {
  padding: '10px 16px',
  borderTop: '1px solid #21262d',
  background: '#0d1117'
};

const COMPOSER: React.CSSProperties = {
  padding: 16,
  borderTop: '1px solid #21262d'
};

const TEXTAREA: React.CSSProperties = {
  width: '100%',
  minHeight: 74,
  resize: 'vertical',
  padding: '10px 12px',
  fontSize: 14,
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6
};

const BTN: React.CSSProperties = {
  padding: '7px 12px',
  background: 'transparent',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background: '#238636',
  borderColor: '#238636',
  color: '#fff'
};

function localMessage(role: WidgetChatMessage['role'], text: string, status?: WidgetChatMessage['status']): WidgetChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    created_at: new Date().toISOString(),
    ...(status ? { status } : {})
  };
}

function cacheBust(url?: string): string {
  if (!url) return '';
  return `${url}${url.includes('?') ? '&' : '?'}rev=${Date.now()}`;
}

export default function WidgetChatPanel({
  open,
  mode,
  widget,
  initialMessage = '',
  widgetPreloadUrl,
  onClose,
  onCreated,
  onSent,
  onDeleted
}: WidgetChatPanelProps) {
  const [value, setValue] = useState(initialMessage);
  const [messages, setMessages] = useState<WidgetChatMessage[]>([]);
  const [currentUuid, setCurrentUuid] = useState<string | null>(widget?.uuid ?? null);
  const [previewUrl, setPreviewUrl] = useState<string>(cacheBust(widget?.htmlUrl));
  const [submitting, setSubmitting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open]);

  const title = mode === 'create' && !currentUuid ? 'New widget' : 'Edit widget';
  const canSend = value.trim().length > 0 && !submitting && !building;

  const loadChat = async (uuid: string) => {
    const next = await window.api.listWidgetChat(uuid);
    setMessages(next);
    setBuilding(next.some((m) => m.status === 'building'));
  };

  useEffect(() => {
    if (!open) return;
    setValue(initialMessage);
    setCurrentUuid(widget?.uuid ?? null);
    setPreviewUrl(cacheBust(widget?.htmlUrl));
    setMessages([]);
    setBuilding(false);
    if (widget?.uuid) {
      void loadChat(widget.uuid);
    }
  }, [open, initialMessage, widget?.uuid, widget?.htmlUrl]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const list = await window.api.secrets.list();
      setProviders(list);
      // Edit mode: seed from widget. Create mode: default to all checked.
      const existing = widget?.selectedProviderIds;
      if (existing !== undefined) {
        setSelectedIds(new Set(existing.filter((id) => list.some((p) => p.id === id))));
      } else {
        setSelectedIds(new Set(list.map((p) => p.id)));
      }
    })();
  }, [open, widget?.uuid]);

  useEffect(() => {
    if (!open || !currentUuid) return;
    const offReady = window.api.onWidgetReady(async (uuid) => {
      if (uuid !== currentUuid) return;
      await loadChat(uuid);
      const htmlUrl = await window.api.htmlUrl(uuid);
      setPreviewUrl(cacheBust(htmlUrl));
      setBuilding(false);
    });
    const offError = window.api.onWidgetError(async (uuid) => {
      if (uuid !== currentUuid) return;
      await loadChat(uuid);
      setBuilding(false);
    });
    return () => {
      offReady();
      offError();
    };
  }, [open, currentUuid]);

  const displayMessages = useMemo(() => messages, [messages]);

  const persistSelection = (next: Set<string>) => {
    if (!currentUuid) return;
    void window.api.setWidgetProviders(currentUuid, Array.from(next));
  };

  const toggleProvider = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistSelection(next);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(() => {
      const next = new Set(providers.map((p) => p.id));
      persistSelection(next);
      return next;
    });
  };

  const selectNone = () => {
    setSelectedIds(() => {
      const next = new Set<string>();
      persistSelection(next);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!currentUuid) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    await window.api.deleteWidget(currentUuid);
    onDeleted(currentUuid);
    setConfirmingDelete(false);
    onClose();
  };

  if (!open) return null;

  const send = async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting || building) return;
    setSubmitting(true);
    setValue('');
    setMessages((prev) => [
      ...prev,
      localMessage('user', trimmed),
      localMessage('status', 'Building...', 'building')
    ]);
    setBuilding(true);

    try {
      if (!currentUuid) {
        const ids = Array.from(selectedIds);
        const { uuid } = await window.api.chatStartWidget(trimmed, ids);
        setCurrentUuid(uuid);
        onCreated(uuid, trimmed, ids);
      } else {
        const result = await window.api.chatSendWidget(currentUuid, trimmed);
        if (!result.ok) {
          setMessages((prev) => [
            ...prev.filter((m) => m.status !== 'building'),
            localMessage('status', `Failed: ${result.error ?? 'unknown'}`, 'failed')
          ]);
          setBuilding(false);
          return;
        }
        onSent(currentUuid, trimmed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div data-chat-scrim style={SCRIM} aria-hidden />
      <aside aria-label="Widget chat" style={PANEL}>
      <div style={HEADER}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {currentUuid && (
            <button
              style={confirmingDelete ? { ...BTN, color: '#f85149', borderColor: '#f85149' } : BTN}
              onClick={() => void handleDelete()}
            >
              {confirmingDelete ? 'click to confirm' : 'Delete widget'}
            </button>
          )}
          <button style={BTN} onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={PREVIEW}>
        {previewUrl && !building ? (
          <webview
            src={previewUrl}
            preload={widgetPreloadUrl}
            webpreferences="contextIsolation=yes, nodeIntegration=no"
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <div>{building ? 'Building preview...' : 'Preview will appear here'}</div>
        )}
      </div>

      <div style={TRANSCRIPT}>
        {displayMessages.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: 13 }}>Describe what this widget should show.</div>
        ) : (
          displayMessages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '86%',
                padding: '8px 10px',
                borderRadius: 6,
                background: m.role === 'user' ? '#1f6feb' : '#21262d',
                color: '#e6edf3',
                fontSize: 13,
                whiteSpace: 'pre-wrap'
              }}
            >
              {m.text}
            </div>
          ))
        )}
      </div>

      <div style={PROVIDERS_BOX} aria-label="Provider selection">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            Providers this widget may use ({selectedIds.size}/{providers.length})
          </span>
          {providers.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ ...BTN, fontSize: 11, padding: '3px 8px' }} onClick={selectAll}>all</button>
              <button style={{ ...BTN, fontSize: 11, padding: '3px 8px' }} onClick={selectNone}>none</button>
            </div>
          )}
        </div>
        {providers.length === 0 ? (
          <div style={{ fontSize: 12, color: '#8b949e' }}>
            No providers configured. Add one in Settings to allow this widget to use authenticated APIs.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {providers.map((p) => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={() => toggleProvider(p.id)}
                  aria-label={`allow ${p.name}`}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={COMPOSER}>
        <textarea
          aria-label="Widget message"
          style={TEXTAREA}
          value={value}
          placeholder="Ask for a widget or describe the next change..."
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              void send();
            }
            if (e.key === 'Escape') onClose();
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 11, color: '#8b949e' }}>Ctrl+Enter to send</span>
          <button style={canSend ? BTN_PRIMARY : { ...BTN_PRIMARY, opacity: 0.5, cursor: 'not-allowed' }} disabled={!canSend} onClick={() => void send()}>
            Send
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
