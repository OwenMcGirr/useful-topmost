import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WidgetChatMessage, WidgetRefreshMode, WidgetWebhookInfo } from '../preload';
import type { PublicProvider } from '../main/secrets-store';
import { categorizeError, stripFailedPrefix } from './errors';

interface WidgetWebhookSummary {
  enabled: boolean;
  cacheKey: 'webhook';
  lastReceivedAt?: string;
}

interface WidgetChatPanelProps {
  open: boolean;
  mode: 'create' | 'edit';
  widget?: {
    uuid: string;
    prompt: string;
    htmlUrl?: string;
    selectedProviderIds?: string[];
    refreshMode?: WidgetRefreshMode;
    refreshTtlMs?: number;
    webhook?: WidgetWebhookSummary;
  };
  initialMessage?: string;
  widgetPreloadUrl: string;
  onClose: () => void;
  onCreated: (uuid: string, prompt: string, selectedProviderIds: string[] | undefined, refreshTtlMs: number, refreshMode?: WidgetRefreshMode, webhook?: WidgetWebhookSummary) => void;
  onSent: (uuid: string, prompt: string) => void;
  onDeleted: (uuid: string) => void;
  onAddProviderRequest?: (name: string) => void;
  onRefreshChanged?: (uuid: string, refreshTtlMs: number, refreshMode?: WidgetRefreshMode, webhook?: WidgetWebhookSummary) => void;
}

type RefreshChoice =
  | { kind: 'live'; label: 'Live' }
  | { kind: 'timed'; label: string; ttlMs: number }
  | { kind: 'event'; label: 'Event-driven' };

export const REFRESH_CHOICES: readonly RefreshChoice[] = [
  { kind: 'live', label: 'Live' },
  { kind: 'timed', label: '1 min', ttlMs: 60_000 },
  { kind: 'timed', label: '5 min', ttlMs: 300_000 },
  { kind: 'timed', label: '15 min', ttlMs: 900_000 },
  { kind: 'timed', label: '1 hour', ttlMs: 3_600_000 },
  { kind: 'timed', label: '6 hours', ttlMs: 21_600_000 },
  { kind: 'timed', label: 'Daily', ttlMs: 86_400_000 },
  { kind: 'event', label: 'Event-driven' }
];

const DEFAULT_REFRESH_TTL_MS = 3_600_000;

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

function choiceValue(choice: RefreshChoice): string {
  if (choice.kind === 'live') return '0';
  if (choice.kind === 'event') return 'event';
  return String(choice.ttlMs);
}

function selectedChoiceValue(mode: WidgetRefreshMode, ttlMs: number): string {
  if (mode === 'event') return 'event';
  if (mode === 'live' || ttlMs === 0) return '0';
  return String(ttlMs);
}

function webhookSummary(info: WidgetWebhookInfo | null): WidgetWebhookSummary | undefined {
  if (!info) return undefined;
  return {
    enabled: info.enabled,
    cacheKey: info.cacheKey,
    lastReceivedAt: info.lastReceivedAt
  };
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
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
  onDeleted,
  onAddProviderRequest,
  onRefreshChanged
}: WidgetChatPanelProps) {
  const [value, setValue] = useState(initialMessage);
  const [messages, setMessages] = useState<WidgetChatMessage[]>([]);
  const [currentUuid, setCurrentUuid] = useState<string | null>(widget?.uuid ?? null);
  const [previewUrl, setPreviewUrl] = useState<string>(cacheBust(widget?.htmlUrl));
  const [submitting, setSubmitting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedFailures, setExpandedFailures] = useState<Set<string>>(new Set());
  const [planSuggestions, setPlanSuggestions] = useState<Array<{ name: string; hostname: string }>>([]);
  const [refreshMode, setRefreshMode] = useState<WidgetRefreshMode>('timed');
  const [refreshTtlMs, setRefreshTtlMs] = useState<number>(DEFAULT_REFRESH_TTL_MS);
  const [refreshDirty, setRefreshDirty] = useState<boolean>(false);
  const [webhookInfo, setWebhookInfo] = useState<WidgetWebhookInfo | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const createdUuidRef = useRef<string | null>(null);
  const autoCloseArmedRef = useRef(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      createdUuidRef.current = null;
      autoCloseArmedRef.current = false;
      setAutoCloseSeconds(null);
    }
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
    const isCreatedWidgetTransition = widget?.uuid !== undefined && widget.uuid === createdUuidRef.current;
    shouldAutoScrollRef.current = true;
    setValue(initialMessage);
    setCurrentUuid(widget?.uuid ?? null);
    setPreviewUrl(cacheBust(widget?.htmlUrl));
    setMessages([]);
    setBuilding(false);
    setPlanSuggestions([]);
    if (!isCreatedWidgetTransition) setAutoCloseSeconds(null);
    if (widget?.uuid) {
      void loadChat(widget.uuid);
    }
  }, [open, initialMessage, widget?.uuid, widget?.htmlUrl]);

  useEffect(() => {
    if (!open || mode !== 'create') return;
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open, mode]);

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
    if (!open) return;
    // Seed the refresh dropdown. Existing widgets without a stored value see
    // the default but we don't persist that until the user actively changes it.
    const nextMode = widget?.refreshMode ?? (widget?.refreshTtlMs === 0 ? 'live' : 'timed');
    setRefreshMode(nextMode);
    if (widget?.refreshTtlMs !== undefined) {
      setRefreshTtlMs(widget.refreshTtlMs);
      setRefreshDirty(true);
    } else {
      setRefreshTtlMs(DEFAULT_REFRESH_TTL_MS);
      setRefreshDirty(false);
    }
    setWebhookInfo(null);
    if (widget?.uuid && nextMode === 'event') {
      void window.api.getWidgetWebhook(widget.uuid).then((info) => {
        if ('ok' in info && info.ok === false) return;
        setWebhookInfo(info);
      });
    }
  }, [open, widget?.uuid, widget?.refreshMode, widget?.refreshTtlMs]);

  useEffect(() => {
    if (!open || !currentUuid) return;
    const offReady = window.api.onWidgetReady(async (uuid) => {
      if (uuid !== currentUuid) return;
      await loadChat(uuid);
      const htmlUrl = await window.api.htmlUrl(uuid);
      setPreviewUrl(cacheBust(htmlUrl));
      setBuilding(false);
      if (autoCloseArmedRef.current && uuid === createdUuidRef.current) {
        autoCloseArmedRef.current = false;
        setAutoCloseSeconds(3);
      }
    });
    const offError = window.api.onWidgetError(async (uuid) => {
      if (uuid !== currentUuid) return;
      await loadChat(uuid);
      setBuilding(false);
      if (uuid === createdUuidRef.current) {
        createdUuidRef.current = null;
        autoCloseArmedRef.current = false;
        setAutoCloseSeconds(null);
      }
    });
    const offPlan = window.api.onWidgetPlan(async (uuid, providers) => {
      if (uuid !== currentUuid) return;
      const saved = await window.api.secrets.list();
      const savedHosts = new Set(saved.flatMap((p) => p.hostnames));
      const missing = providers.filter((entry) => entry.hostname && !savedHosts.has(entry.hostname));
      // Deduplicate by hostname to avoid stacking identical banners.
      const seen = new Set<string>();
      const unique: typeof missing = [];
      for (const m of missing) {
        if (seen.has(m.hostname)) continue;
        seen.add(m.hostname);
        unique.push(m);
      }
      setPlanSuggestions(unique);
    });
    return () => {
      offReady();
      offError();
      offPlan();
    };
  }, [open, currentUuid]);

  const displayMessages = useMemo(() => messages, [messages]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!shouldAutoScrollRef.current) return;
    if (typeof transcriptEndRef.current?.scrollIntoView !== 'function') return;
    transcriptEndRef.current.scrollIntoView({ block: 'end' });
  }, [open, displayMessages]);

  useEffect(() => {
    if (autoCloseSeconds === null) return;
    if (autoCloseSeconds <= 0) {
      onClose();
      return;
    }
    const timer = window.setTimeout(() => setAutoCloseSeconds((current) => {
      if (current === null) return null;
      if (current <= 1) {
        onClose();
        return null;
      }
      return current - 1;
    }), 1000);
    return () => window.clearTimeout(timer);
  }, [autoCloseSeconds, onClose]);

  const cancelAutoClose = () => {
    if (autoCloseSeconds === null) return;
    autoCloseArmedRef.current = false;
    setAutoCloseSeconds(null);
  };

  const handleTranscriptScroll = () => {
    const el = transcriptRef.current;
    if (!el) return;
    shouldAutoScrollRef.current = isNearBottom(el);
  };

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

  const handleRefreshChange = async (value: string) => {
    setRefreshDirty(true);
    if (value === 'event') {
      setRefreshMode('event');
      if (currentUuid) {
        const result = await window.api.setWidgetRefreshMode(currentUuid, 'event');
        if (result.ok) {
          const info = await window.api.getWidgetWebhook(currentUuid);
          if (!('ok' in info && info.ok === false)) {
            setWebhookInfo(info);
            onRefreshChanged?.(currentUuid, refreshTtlMs, 'event', webhookSummary(info));
          }
        }
      }
      return;
    }
    setWebhookInfo(null);
    if (value === '0') {
      setRefreshMode('live');
      setRefreshTtlMs(0);
      if (currentUuid) {
        void window.api.setWidgetRefreshTtl(currentUuid, 0);
        onRefreshChanged?.(currentUuid, 0, 'live');
      }
      return;
    }
    const next = Number(value);
    setRefreshMode('timed');
    setRefreshTtlMs(next);
    if (currentUuid) {
      void window.api.setWidgetRefreshTtl(currentUuid, next);
      onRefreshChanged?.(currentUuid, next, 'timed');
    }
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
    shouldAutoScrollRef.current = true;
    setSubmitting(true);
    setValue('');
    setMessages((prev) => [
      ...prev,
      localMessage('user', trimmed),
      localMessage('status', 'Building…', 'building')
    ]);
    setBuilding(true);

    try {
      if (!currentUuid) {
        const ids = Array.from(selectedIds);
        const { uuid } = await window.api.chatStartWidget(trimmed, ids, refreshTtlMs);
        let createdWebhook: WidgetWebhookInfo | null = null;
        if (refreshMode === 'event') {
          const result = await window.api.setWidgetRefreshMode(uuid, 'event');
          if (result.ok) {
            const info = await window.api.getWidgetWebhook(uuid);
            if (!('ok' in info && info.ok === false)) {
              createdWebhook = info;
              setWebhookInfo(info);
            }
          }
        }
        createdUuidRef.current = uuid;
        autoCloseArmedRef.current = true;
        setCurrentUuid(uuid);
        if (refreshMode === 'event') {
          onCreated(uuid, trimmed, ids, refreshTtlMs, refreshMode, webhookSummary(createdWebhook));
        } else {
          onCreated(uuid, trimmed, ids, refreshTtlMs);
        }
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
      <aside
        aria-label="Widget chat"
        style={PANEL}
        onPointerDown={cancelAutoClose}
        onKeyDown={cancelAutoClose}
      >
      <div style={HEADER}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {currentUuid && (
            <button
              style={confirmingDelete ? { ...BTN, color: '#f85149', borderColor: '#f85149' } : BTN}
              onClick={() => void handleDelete()}
            >
              {confirmingDelete ? 'Click to confirm' : 'Delete widget'}
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
          <div>{building ? 'Building preview…' : 'Preview will appear here'}</div>
        )}
      </div>

      <div
        ref={transcriptRef}
        style={TRANSCRIPT}
        aria-label="Chat transcript"
        onScroll={handleTranscriptScroll}
      >
        {displayMessages.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: 13 }}>Describe what this widget should show.</div>
        ) : (
          displayMessages.map((m) => {
            if (m.status === 'failed') {
              const stripped = stripFailedPrefix(m.text);
              const friendly = categorizeError(stripped);
              const expanded = expandedFailures.has(m.id);
              return (
                <div
                  key={m.id}
                  role="alert"
                  style={{
                    alignSelf: 'stretch',
                    padding: '10px 12px',
                    borderLeft: '3px solid #f85149',
                    borderRadius: 6,
                    background: 'rgba(248, 81, 73, 0.08)',
                    color: '#e6edf3',
                    fontSize: 13,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <div style={{ color: '#f85149', fontWeight: 600 }}>{friendly.title}</div>
                  {friendly.advice && <div style={{ opacity: 0.85 }}>{friendly.advice}</div>}
                  <button
                    style={{
                      alignSelf: 'flex-start',
                      background: 'transparent',
                      color: '#e6edf3',
                      border: '1px solid #30363d',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                    aria-expanded={expanded}
                    onClick={() => {
                      setExpandedFailures((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      });
                    }}
                  >
                    {expanded ? 'Hide details' : 'See details'}
                  </button>
                  {expanded && (
                    <pre
                      style={{
                        margin: 0,
                        padding: 8,
                        background: '#0d1117',
                        border: '1px solid #30363d',
                        borderRadius: 4,
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 160,
                        overflowY: 'auto'
                      }}
                    >
                      {stripped}
                    </pre>
                  )}
                </div>
              );
            }
            return (
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
            );
          })
        )}
        <div ref={transcriptEndRef} aria-hidden />
      </div>

      <div style={PROVIDERS_BOX}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#8b949e' }}>
          <span>Refresh{refreshDirty || mode === 'create' ? '' : ' (default)'}</span>
          <select
            aria-label="Refresh cadence"
            value={selectedChoiceValue(refreshMode, refreshTtlMs)}
            onChange={(e) => void handleRefreshChange(e.target.value)}
            style={{
              background: '#0d1117',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12
            }}
          >
            {REFRESH_CHOICES.map((p) => (
              <option key={choiceValue(p)} value={choiceValue(p)}>{p.label}</option>
            ))}
          </select>
        </label>
        {refreshMode === 'event' && webhookInfo && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#8b949e' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: '0 0 auto' }}>Webhook URL</span>
              <input
                readOnly
                value={webhookInfo.urlCandidates[0] ?? webhookInfo.path}
                aria-label="Webhook URL"
                style={{
                  minWidth: 0,
                  flex: 1,
                  background: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontSize: 11
                }}
              />
              <button
                style={{ ...BTN, fontSize: 11, padding: '4px 8px' }}
                onClick={() => void navigator.clipboard?.writeText(webhookInfo.urlCandidates[0] ?? webhookInfo.path)}
              >
                Copy
              </button>
            </div>
            <div>Cache key: webhook</div>
            {webhookInfo.lastReceivedAt && (
              <div>Last event: {new Date(webhookInfo.lastReceivedAt).toLocaleString()}</div>
            )}
          </div>
        )}
      </div>

      <div style={PROVIDERS_BOX} aria-label="Provider selection">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            Providers this widget may use ({selectedIds.size}/{providers.length})
          </span>
          {providers.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ ...BTN, fontSize: 11, padding: '3px 8px' }} onClick={selectAll}>All</button>
              <button style={{ ...BTN, fontSize: 11, padding: '3px 8px' }} onClick={selectNone}>None</button>
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
                  aria-label={`Allow ${p.name}`}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {planSuggestions.length > 0 && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid #21262d', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {planSuggestions.map((entry) => (
            <div
              key={entry.hostname}
              role="status"
              style={{
                padding: '8px 10px',
                borderLeft: '3px solid #d29922',
                borderRadius: 6,
                background: 'rgba(210, 153, 34, 0.08)',
                color: '#e6edf3',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}
            >
              <span>This widget will use {entry.name}.</span>
              <button
                style={{
                  background: 'transparent',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => onAddProviderRequest?.(entry.name)}
              >
                Add provider
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={COMPOSER}>
        <textarea
          ref={textareaRef}
          aria-label="Widget message"
          style={TEXTAREA}
          value={value}
          placeholder="Ask for a widget or describe the next change…"
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
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            {autoCloseSeconds === null ? 'Ctrl+Enter to send' : `Closing in ${autoCloseSeconds}s`}
          </span>
          <button style={canSend ? BTN_PRIMARY : { ...BTN_PRIMARY, opacity: 0.5, cursor: 'not-allowed' }} disabled={!canSend} onClick={() => void send()}>
            Send
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
