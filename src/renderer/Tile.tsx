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
  onRefresh: () => void;
  onDismiss: () => void;
  onEditChat: () => void;
  onTogglePinned: () => void;
  onCycleSize: () => void;
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

export default function Tile(props: Props) {
  const wvRef = useRef<HTMLElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

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

      {props.state.kind === 'building' && (
        <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#8b949e' }}>
          building widget…
        </div>
      )}

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
