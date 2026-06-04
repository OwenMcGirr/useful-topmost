import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WidgetChatMessage, WidgetQuestionTopic, WidgetRefreshMode, WidgetWebhookInfo } from '../preload';
import type { PublicProvider } from '../main/secrets-store';
import { categorizeError, stripFailedPrefix } from './errors';
import './WidgetWorkspace.css';

interface WidgetWebhookSummary {
  enabled: boolean;
  cacheKey: 'webhook';
  lastReceivedAt?: string;
}

interface WidgetWorkspaceProps {
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

function terminalMessage(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
}

export default function WidgetWorkspace({
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
}: WidgetWorkspaceProps) {
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
  const [webhookTestStatus, setWebhookTestStatus] = useState<string | null>(null);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
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
    if (widget?.uuid) void loadChat(widget.uuid);
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
    setWebhookTestStatus(null);
    setWebhookOpen(false);
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
    const offPlan = window.api.onWidgetPlan(async (uuid, nextProviders) => {
      if (uuid !== currentUuid) return;
      const saved = await window.api.secrets.list();
      const savedHosts = new Set(saved.flatMap((p) => p.hostnames));
      const missing = nextProviders.filter((entry) => entry.hostname && !savedHosts.has(entry.hostname));
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

  const handleRefreshChange = async (nextValue: string) => {
    setRefreshDirty(true);
    if (nextValue === 'event') {
      setRefreshMode('event');
      if (currentUuid) {
        const result = await window.api.setWidgetRefreshMode(currentUuid, 'event');
        if (result.ok) {
          const info = await window.api.getWidgetWebhook(currentUuid);
          if (!('ok' in info && info.ok === false)) {
            setWebhookInfo(info);
            setWebhookTestStatus(null);
            setWebhookOpen(true);
            onRefreshChanged?.(currentUuid, refreshTtlMs, 'event', webhookSummary(info));
          }
        }
      }
      return;
    }
    setWebhookInfo(null);
    setWebhookTestStatus(null);
    setWebhookOpen(false);
    if (nextValue === '0') {
      setRefreshMode('live');
      setRefreshTtlMs(0);
      if (currentUuid) {
        void window.api.setWidgetRefreshTtl(currentUuid, 0);
        onRefreshChanged?.(currentUuid, 0, 'live');
      }
      return;
    }
    const next = Number(nextValue);
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

  const testWebhook = async () => {
    if (!currentUuid) return;
    setWebhookTestStatus('Testing local webhook…');
    const result = await window.api.testWidgetWebhook(currentUuid);
    if (result.ok) {
      setWebhookTestStatus('Test event received.');
      const info = await window.api.getWidgetWebhook(currentUuid);
      if (!('ok' in info && info.ok === false)) setWebhookInfo(info);
      return;
    }
    setWebhookTestStatus(terminalMessage(result.error));
  };

  const answerQuestion = async (topic: WidgetQuestionTopic) => {
    if (!currentUuid) return;
    const result = await window.api.answerWidgetQuestion(currentUuid, topic);
    if (result.ok) {
      setMessages((prev) => [...prev, result.message]);
      return;
    }
    setMessages((prev) => [
      ...prev,
      localMessage('assistant', terminalMessage(result.error))
    ]);
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
        const { uuid } = await window.api.chatStartWidget(trimmed, ids, refreshTtlMs, refreshMode);
        let createdWebhook: WidgetWebhookInfo | null = null;
        if (refreshMode === 'event') {
          const result = await window.api.setWidgetRefreshMode(uuid, 'event');
          if (result.ok) {
            const info = await window.api.getWidgetWebhook(uuid);
            if (!('ok' in info && info.ok === false)) {
              createdWebhook = info;
              setWebhookInfo(info);
              setWebhookTestStatus(null);
              setWebhookOpen(true);
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

  const renderMessages = () => {
    if (displayMessages.length === 0) {
      return <div style={{ color: '#8b949e', fontSize: 13 }}>Describe what this widget should show.</div>;
    }
    return displayMessages.map((m) => {
      if (m.status === 'failed') {
        const stripped = stripFailedPrefix(m.text);
        const friendly = categorizeError(stripped);
        const expanded = expandedFailures.has(m.id);
        return (
          <div key={m.id} role="alert" className="widget-workspace-error">
            <div style={{ color: '#f85149', fontWeight: 600 }}>{friendly.title}</div>
            {friendly.advice && <div style={{ opacity: 0.85 }}>{friendly.advice}</div>}
            <button
              style={{ ...BTN, alignSelf: 'flex-start', padding: '3px 8px', fontSize: 11 }}
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
            {expanded && <pre className="widget-workspace-error-details">{stripped}</pre>}
          </div>
        );
      }
      return (
        <div
          key={m.id}
          className={
            m.role === 'user'
              ? 'widget-message widget-message-user'
              : m.role === 'assistant'
                ? 'widget-message widget-message-assistant'
                : 'widget-message widget-message-status'
          }
        >
          {m.text}
        </div>
      );
    });
  };

  const renderSuggestedQuestions = () => {
    if (!currentUuid || refreshMode !== 'event' || submitting || building) return null;
    const questions: Array<{ label: string; topic: WidgetQuestionTopic }> = [
      { label: 'What should this widget receive?', topic: 'webhook-input' },
      { label: 'How do I send an event?', topic: 'webhook-send' }
    ];
    if (webhookInfo && !webhookInfo.publicUrl) {
      questions.push({ label: 'Why is this URL local only?', topic: 'webhook-local-url' });
    }
    return (
      <div className="widget-workspace-suggested-questions" aria-label="Suggested questions">
        {questions.map((question) => (
          <button key={question.topic} style={{ ...BTN, fontSize: 11, padding: '4px 8px' }} onClick={() => void answerQuestion(question.topic)}>
            {question.label}
          </button>
        ))}
      </div>
    );
  };

  const renderWebhookSetup = () => {
    if (refreshMode !== 'event' || !webhookInfo) return null;
    const localUrl = webhookInfo.localUrlCandidates[0] ?? webhookInfo.urlCandidates.find((url) => url.startsWith('http://')) ?? webhookInfo.path;
    const publicUrl = webhookInfo.publicUrl;
    const row = (label: string, url: string, copyLabel: string) => (
      <div className="widget-workspace-url-row">
        <span>{label}</span>
        <input readOnly value={url} aria-label={label} className="widget-workspace-url-input" />
        <button style={{ ...BTN, fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap' }} onClick={() => void navigator.clipboard?.writeText(url)}>
          {copyLabel}
        </button>
      </div>
    );
    return (
      <details className="widget-workspace-section" open={webhookOpen} onToggle={(e) => setWebhookOpen(e.currentTarget.open)}>
        <summary className="widget-workspace-section-summary">Webhook setup</summary>
        <div className="widget-workspace-section-body">
          <div className="widget-workspace-webhook">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ color: '#e6edf3', fontWeight: 600 }}>Status</strong>
              <span className={publicUrl ? 'widget-workspace-pill widget-workspace-pill-public' : 'widget-workspace-pill widget-workspace-pill-local'}>
                {publicUrl ? 'Public' : 'Local only'}
              </span>
            </div>
            <div>
              {publicUrl
                ? 'External services can send events to the public webhook URL.'
                : 'This URL works on your local network. External services need a public URL.'}
            </div>
            {publicUrl && row('Public webhook URL', publicUrl, 'Copy public URL')}
            {row('Local webhook URL', localUrl, 'Copy local URL')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button style={{ ...BTN, fontSize: 11, padding: '4px 8px' }} onClick={() => void testWebhook()}>
                Test local webhook
              </button>
              {webhookTestStatus && <span role={webhookTestStatus.endsWith('.') ? undefined : 'status'}>{webhookTestStatus}</span>}
            </div>
            {webhookInfo.lastReceivedAt && <div>Last event: {new Date(webhookInfo.lastReceivedAt).toLocaleString()}</div>}
          </div>
        </div>
      </details>
    );
  };

  return (
    <>
      <div data-chat-scrim className="widget-workspace-scrim" aria-hidden />
      <section aria-label="Widget workspace" className="widget-workspace" onPointerDown={cancelAutoClose} onKeyDown={cancelAutoClose}>
        <header className="widget-workspace-header">
          <div className="widget-workspace-title-row">
            <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {currentUuid && (
              <button style={confirmingDelete ? { ...BTN, color: '#f85149', borderColor: '#f85149' } : BTN} onClick={() => void handleDelete()}>
                {confirmingDelete ? 'Click to confirm' : 'Delete widget'}
              </button>
            )}
            <button style={BTN} onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="widget-workspace-body">
          <section className="widget-workspace-preview-pane" aria-label="Preview pane">
            <h3 className="widget-workspace-pane-title">Preview</h3>
            <div className="widget-workspace-preview-shell">
              {previewUrl && !building ? (
                <webview src={previewUrl} preload={widgetPreloadUrl} webpreferences="contextIsolation=yes, nodeIntegration=no" style={{ width: '100%', height: '100%', border: 0 }} />
              ) : (
                <div>{building ? 'Building preview…' : 'Preview will appear here'}</div>
              )}
            </div>
          </section>

          <section className="widget-workspace-chat-pane" aria-label="Chat pane">
            <div ref={transcriptRef} className="widget-workspace-transcript" aria-label="Chat transcript" onScroll={handleTranscriptScroll}>
              {renderMessages()}
              <div ref={transcriptEndRef} aria-hidden />
            </div>

            <div className="widget-workspace-advanced" aria-label="Advanced widget options">
              <details className="widget-workspace-section" open={refreshOpen} onToggle={(e) => setRefreshOpen(e.currentTarget.open)}>
                <summary className="widget-workspace-section-summary">Refresh</summary>
                <div className="widget-workspace-section-body">
                  <label className="widget-workspace-refresh-row">
                    <span>Refresh{refreshDirty || mode === 'create' ? '' : ' (default)'}</span>
                    <select
                      aria-label="Refresh cadence"
                      value={selectedChoiceValue(refreshMode, refreshTtlMs)}
                      onChange={(e) => void handleRefreshChange(e.target.value)}
                      className="widget-workspace-select"
                    >
                      {REFRESH_CHOICES.map((p) => <option key={choiceValue(p)} value={choiceValue(p)}>{p.label}</option>)}
                    </select>
                  </label>
                </div>
              </details>

              {renderWebhookSetup()}

              <details className="widget-workspace-section" open={providersOpen} onToggle={(e) => setProvidersOpen(e.currentTarget.open)}>
                <summary className="widget-workspace-section-summary">Providers</summary>
                <div className="widget-workspace-section-body" aria-label="Provider selection">
                  <div className="widget-workspace-provider-header">
                    <span>Providers this widget may use ({selectedIds.size}/{providers.length})</span>
                    {providers.length > 0 && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={{ ...BTN, fontSize: 11, padding: '3px 8px' }} onClick={selectAll}>All</button>
                        <button style={{ ...BTN, fontSize: 11, padding: '3px 8px' }} onClick={selectNone}>None</button>
                      </div>
                    )}
                  </div>
                  {providers.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#8b949e' }}>No providers configured. Add one in Settings to allow this widget to use authenticated APIs.</div>
                  ) : (
                    <div className="widget-workspace-provider-list">
                      {providers.map((p) => (
                        <label key={p.id} className="widget-workspace-provider-row">
                          <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleProvider(p.id)} aria-label={`Allow ${p.name}`} />
                          <span>{p.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </details>

              {planSuggestions.length > 0 && (
                <details className="widget-workspace-section" open>
                  <summary className="widget-workspace-section-summary">Provider suggestions</summary>
                  <div className="widget-workspace-section-body widget-workspace-suggestions">
                    {planSuggestions.map((entry) => (
                      <div key={entry.hostname} role="status" className="widget-workspace-suggestion">
                        <span>This widget will use {entry.name}.</span>
                        <button style={{ ...BTN, fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap' }} onClick={() => onAddProviderRequest?.(entry.name)}>
                          Add provider
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <div className="widget-workspace-composer">
              {renderSuggestedQuestions()}
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
              <div className="widget-workspace-composer-footer">
                <span>{autoCloseSeconds === null ? 'Ctrl+Enter to send' : `Closing in ${autoCloseSeconds}s`}</span>
                <button style={canSend ? BTN_PRIMARY : { ...BTN_PRIMARY, opacity: 0.5, cursor: 'not-allowed' }} disabled={!canSend} onClick={() => void send()}>
                  Send
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
