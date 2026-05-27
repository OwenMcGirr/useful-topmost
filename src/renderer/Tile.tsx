import { useEffect, useRef, useState } from 'react';
import type { TileState } from './types';
import type { WidgetSize } from '../preload';

interface Props {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
  widgetPreloadUrl: string;
  pinned?: boolean;
  size?: WidgetSize;
  geekMode?: boolean;
  summary?: { sources: string[] };
  onRefresh: () => void;
  onDismiss: () => void;
  onEditChat: () => void;
  onTogglePinned: () => void;
  onCycleSize: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

const SIZE_LABEL: Record<WidgetSize, string> = {
  small: 'size 1×1',
  wide: 'size 2×1',
  large: 'size 2×2'
};

const TILE: React.CSSProperties = {
  position: 'relative', width: '100%', height: '100%',
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
      <div style={{ fontSize: 13 }}>building widget… {elapsed}s</div>
      <button style={{ ...BTN, fontSize: 12 }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

export default function Tile(props: Props) {
  const wvRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

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

  const handleRefresh = () => {
    const wv = wvRef.current as any;
    if (wv && typeof wv.reload === 'function') wv.reload();
    props.onRefresh();
  };

  const handleDelete = () => {
    if (confirmingDelete) {
      props.onDismiss();
      return;
    }
    setConfirmingDelete(true);
  };

  return (
    <div className="tile" style={TILE}>
      {props.pinned === true && <div data-pin-indicator aria-label="pinned" style={PIN_BADGE} />}
      <div className="tile-chrome" data-chrome style={CHROME}>
        {props.geekMode === true && (
          <button
            aria-label="data sources"
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
          {props.pinned === true ? 'unpin' : 'pin'}
        </button>
        {props.state.kind === 'live' && (
          <>
            <button style={BTN} onClick={handleRefresh}>refresh</button>
            <button style={BTN} onClick={props.onEditChat}>edit with chat</button>
          </>
        )}
        {props.state.kind === 'error' && (
          <button style={BTN} onClick={props.onRetry}>retry</button>
        )}
        <button
          style={confirmingDelete ? { ...BTN, color: '#f85149', borderColor: '#f85149' } : BTN}
          onClick={handleDelete}
        >
          {confirmingDelete ? 'click to confirm' : 'delete'}
        </button>
      </div>

      {infoOpen && (
        <div ref={popoverRef} role="dialog" aria-label="data sources" style={POPOVER}>
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
        </div>
      )}

      {props.state.kind === 'building' && <BuildingState onCancel={props.onCancel} />}

      {props.state.kind === 'live' && (
        <webview
          ref={wvRef}
          src={props.htmlUrl}
          preload={props.widgetPreloadUrl}
          webpreferences="contextIsolation=yes, nodeIntegration=no"
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      )}

      {props.state.kind === 'error' && (
        <div style={{ padding: 16, color: '#f85149', fontSize: 14, overflow: 'auto', height: '100%' }}>
          {props.state.message}
        </div>
      )}
    </div>
  );
}
