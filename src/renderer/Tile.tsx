import { useCallback, useEffect, useRef, useState } from 'react';
import type { TileState } from './types';
import type { WidgetRefreshMode, WidgetSize, WidgetFetchLogEntry } from '../preload';
import { categorizeError } from './errors';

interface Props {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
  widgetPreloadUrl: string;
  pinned?: boolean;
  size?: WidgetSize;
  geekMode?: boolean;
  summary?: { sources: string[]; name?: string };
  refreshMode?: WidgetRefreshMode;
  refreshTtlMs?: number;
  webhookReceivedAt?: string;
  onRefresh: () => void;
  onDismiss: () => void;
  onEditChat: () => void;
  onTogglePinned: () => void;
  onCycleSize: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

const SIZE_LABEL: Record<WidgetSize, string> = {
  small: 'Size 1×1',
  wide: 'Size 2×1',
  large: 'Size 2×2'
};

const DEFAULT_REFRESH_TTL_MS = 3_600_000;
const LIVE_RELOAD_INTERVAL_MS = 30_000;
const STRIP_HEIGHT = 28;

function frameReloadIntervalMs(refreshTtlMs: number | undefined): number {
  if (refreshTtlMs === 0) return LIVE_RELOAD_INTERVAL_MS;
  if (typeof refreshTtlMs === 'number' && Number.isFinite(refreshTtlMs) && refreshTtlMs > 0) {
    return refreshTtlMs;
  }
  return DEFAULT_REFRESH_TTL_MS;
}

function widgetDisplayName(prompt: string, summary?: { name?: string }): string {
  const name = summary?.name?.trim();
  if (name) return name;
  const fallback = prompt.trim();
  return fallback || 'Widget';
}

function formatUpdatedAt(date: Date): string {
  return `Updated at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const TILE: React.CSSProperties = {
  position: 'relative', width: '100%', height: '100%',
  display: 'flex', flexDirection: 'column',
  background: '#161b22', border: '1px solid #30363d',
  borderRadius: 6, overflow: 'hidden'
};

const PIN_BADGE: React.CSSProperties = {
  position: 'absolute', top: 8, left: 8,
  width: 8, height: 8, borderRadius: '50%',
  background: '#58a6ff', boxShadow: '0 0 6px rgba(88,166,255,0.6)',
  zIndex: 5, pointerEvents: 'none'
};

const CHROME: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, right: 0,
  padding: '4px 8px', display: 'flex', gap: 4, justifyContent: 'flex-end',
  background: 'rgba(13,17,23,0.85)', zIndex: 10
};

const BTN: React.CSSProperties = {
  background: 'transparent', color: '#e6edf3',
  border: '1px solid #30363d', borderRadius: 4,
  padding: '4px 8px', fontSize: 12, cursor: 'pointer'
};

const POPOVER: React.CSSProperties = {
  position: 'absolute', top: 40, right: 8,
  width: 220, maxHeight: 200, overflowY: 'auto',
  background: '#0d1117', color: '#e6edf3',
  border: '1px solid #30363d', borderRadius: 6,
  padding: '10px 12px', fontSize: 12, zIndex: 20,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
};

const CONTENT_AREA: React.CSSProperties = {
  flex: '1 1 0',
  minHeight: 0,
  minWidth: 0,
  position: 'relative'
};

const BOTTOM_STRIP: React.CSSProperties = {
  flex: '0 0 auto',
  height: STRIP_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 10px',
  background: 'linear-gradient(180deg, rgba(13, 17, 23, 0), rgba(13, 17, 23, 0.9) 38%, rgba(13, 17, 23, 0.94))',
  color: '#8b949e',
  fontSize: 11,
  zIndex: 1,
  pointerEvents: 'none'
};

const STRIP_NAME: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#c9d1d9'
};

const STRIP_META: React.CSSProperties = {
  flex: '0 0 auto',
  color: '#8b949e'
};

function BuildingState({ onCancel }: { onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
      <span className="spinner" aria-hidden />
      <div style={{ fontSize: 13 }}>Building widget… {elapsed}s</div>
      <button style={{ ...BTN, fontSize: 12 }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

export default function Tile(props: Props) {
  const wvRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [fetchLog, setFetchLog] = useState<WidgetFetchLogEntry[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (props.state.kind !== 'error') setErrorDetailsOpen(false);
  }, [props.state.kind]);

  useEffect(() => {
    if (props.state.kind !== 'live') {
      setUpdatedAt(null);
      return;
    }
    setUpdatedAt(null);
  }, [props.state.kind, props.htmlUrl]);

  const handleWebviewLoaded = useCallback(() => {
    setUpdatedAt(new Date());
  }, []);

  const handleWebviewRef = useCallback((node: HTMLElement | null) => {
    const previous = wvRef.current;
    if (previous) previous.removeEventListener('did-finish-load', handleWebviewLoaded);
    wvRef.current = node;
    if (node) node.addEventListener('did-finish-load', handleWebviewLoaded);
  }, [handleWebviewLoaded]);

  useEffect(() => {
    if (!infoOpen || !props.geekMode) return;
    let cancelled = false;
    const load = () => {
      void window.api.getWidgetFetchLog(props.uuid).then((entries) => {
        if (!cancelled) setFetchLog(entries);
      });
    };
    load();
    // Refresh while the popover is open so a fresh fetch appears without
    // having to close and reopen.
    const timer = window.setInterval(load, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [infoOpen, props.geekMode, props.uuid]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  useEffect(() => {
    if (!infoOpen) return;
    const onDown = (e: MouseEvent) => {
      const node = popoverRef.current;
      if (node && !node.contains(e.target as Node)) setInfoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInfoOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [infoOpen]);

  const reloadFrame = () => {
    const wv = wvRef.current as any;
    if (wv && typeof wv.reload === 'function') {
      wv.reload();
      return;
    }
    props.onRefresh();
  };

  useEffect(() => {
    if (props.state.kind !== 'live') return;
    if (props.refreshMode === 'event') return;
    const intervalMs = frameReloadIntervalMs(props.refreshTtlMs);
    const timer = window.setInterval(reloadFrame, intervalMs);
    return () => window.clearInterval(timer);
  }, [props.state.kind, props.refreshMode, props.refreshTtlMs, props.htmlUrl]);

  const handleDelete = () => {
    if (confirmingDelete) {
      props.onDismiss();
      return;
    }
    setConfirmingDelete(true);
  };
  const displayName = widgetDisplayName(props.prompt, props.summary);
  const statusLabel = props.state.kind === 'live'
    ? props.refreshMode === 'event' && updatedAt === null
      ? props.webhookReceivedAt ? 'Event received.' : 'Waiting for event.'
      : updatedAt === null ? 'Loading…' : formatUpdatedAt(updatedAt)
    : props.state.kind === 'building' ? 'Building…' : 'Error';

  return (
    <div className="tile" style={TILE}>
      {props.pinned === true && <div data-pin-indicator aria-label="Pinned" style={PIN_BADGE} />}
      <div className="tile-chrome" data-chrome style={CHROME}>
        {props.geekMode === true && (
          <button
            aria-label="Data sources"
            title="Data sources"
            style={BTN}
            onClick={() => setInfoOpen((v) => !v)}
          >
            (i)
          </button>
        )}
        <button style={BTN} onClick={props.onCycleSize}>
          {SIZE_LABEL[props.size ?? 'small']}
        </button>
        <button style={BTN} onClick={props.onTogglePinned}>
          {props.pinned === true ? 'Unpin' : 'Pin'}
        </button>
        {props.state.kind === 'live' && (
          <>
            <button style={BTN} onClick={reloadFrame}>Refresh</button>
            <button style={BTN} onClick={props.onEditChat}>Edit with chat</button>
          </>
        )}
        {props.state.kind === 'error' && (
          <button style={BTN} onClick={props.onRetry}>Retry</button>
        )}
        <button
          style={confirmingDelete ? { ...BTN, color: '#f85149', borderColor: '#f85149' } : BTN}
          onClick={handleDelete}
        >
          {confirmingDelete ? 'Click to confirm' : 'Delete'}
        </button>
      </div>

      {infoOpen && (
        <div ref={popoverRef} role="dialog" aria-label="Data sources" style={POPOVER}>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Data sources
          </div>
          {props.summary === undefined ? (
            <div style={{ opacity: 0.7 }}>No data sources recorded.</div>
          ) : props.summary.sources.length === 0 ? (
            <div style={{ opacity: 0.7 }}>This widget uses no external sources.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {props.summary.sources.map((s) => <li key={s}>{s}</li>)}
            </ul>
          )}

          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Recent calls
          </div>
          {fetchLog.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No calls yet.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 11 }}>
              {[...fetchLog].reverse().map((entry, idx) => {
                const failed = entry.status === 0 || entry.status >= 400;
                let host = entry.url;
                try { host = new URL(entry.url).host + new URL(entry.url).pathname; } catch { /* keep raw */ }
                return (
                  <li key={`${entry.at}-${idx}`} style={{ marginBottom: 4, lineHeight: 1.4 }}>
                    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${entry.method} ${entry.url}`}>
                      {entry.method} {host}
                    </div>
                    <div style={{ opacity: 0.8 }}>
                      <span style={{ color: failed ? '#f85149' : '#3fb950' }}>
                        {entry.status === 0 ? 'network error' : `${entry.status}`}
                      </span>
                      {' · '}{entry.durationMs} ms · {entry.responseBytes} bytes
                    </div>
                    {entry.errorBody && (
                      <div style={{ color: '#f85149', opacity: 0.85, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.errorBody}>
                        {entry.errorBody}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div style={CONTENT_AREA}>
        {props.state.kind === 'building' && <BuildingState onCancel={props.onCancel} />}

        {props.state.kind === 'live' && (
          <webview
            ref={handleWebviewRef}
            src={props.htmlUrl}
            preload={props.widgetPreloadUrl}
            webpreferences="contextIsolation=yes, nodeIntegration=no"
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        )}

        {props.state.kind === 'error' && (() => {
          const friendly = categorizeError(props.state.message);
          return (
            <div
              role="alert"
              style={{ padding: 16, fontSize: 13, color: '#e6edf3', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ color: '#f85149', fontSize: 14, fontWeight: 600 }}>{friendly.title}</div>
              {friendly.advice && <div style={{ opacity: 0.85 }}>{friendly.advice}</div>}
              <button
                style={{ ...BTN, alignSelf: 'flex-start' }}
                onClick={() => setErrorDetailsOpen((v) => !v)}
                aria-expanded={errorDetailsOpen}
              >
                {errorDetailsOpen ? 'Hide details' : 'See details'}
              </button>
              {errorDetailsOpen && (
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
                  {props.state.message}
                </pre>
              )}
            </div>
          );
        })()}
      </div>

      <div style={BOTTOM_STRIP} aria-label="Widget details">
        <span style={STRIP_NAME} title={displayName}>{displayName}</span>
        <span style={STRIP_META}>{statusLabel}</span>
      </div>
    </div>
  );
}
