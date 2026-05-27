import { useRef } from 'react';
import type { TileState } from './types';

interface Props {
  uuid: string;
  prompt: string;
  state: TileState;
  htmlUrl: string;
  widgetPreloadUrl: string;
  onRefresh: () => void;
  onDismiss: () => void;
  onEditChat: () => void;
  onRetry: () => void;
}

const TILE: React.CSSProperties = {
  position: 'relative', width: 400, height: 300,
  background: '#161b22', border: '1px solid #30363d',
  borderRadius: 6, overflow: 'hidden'
};

const CHROME: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, right: 0,
  padding: '4px 8px', display: 'flex', gap: 4, justifyContent: 'flex-end',
  background: 'rgba(13,17,23,0.85)', opacity: 0,
  transition: 'opacity 120ms ease-in', zIndex: 10
};

const BTN: React.CSSProperties = {
  background: 'transparent', color: '#e6edf3',
  border: '1px solid #30363d', borderRadius: 4,
  padding: '4px 8px', fontSize: 12, cursor: 'pointer'
};

export default function Tile(props: Props) {
  const wvRef = useRef<HTMLElement>(null);
  const handleRefresh = () => {
    const wv = wvRef.current as any;
    if (wv && typeof wv.reload === 'function') wv.reload();
    props.onRefresh();
  };

  return (
    <div
      style={TILE}
      onMouseEnter={(e) => {
        const chrome = e.currentTarget.querySelector<HTMLDivElement>('[data-chrome]');
        if (chrome) chrome.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        const chrome = e.currentTarget.querySelector<HTMLDivElement>('[data-chrome]');
        if (chrome) chrome.style.opacity = '0';
      }}
    >
      <div data-chrome style={CHROME}>
        {props.state.kind === 'live' && (
          <>
            <button style={BTN} onClick={handleRefresh}>refresh</button>
            <button style={BTN} onClick={props.onEditChat}>edit with chat</button>
          </>
        )}
        {props.state.kind === 'error' && (
          <button style={BTN} onClick={props.onRetry}>retry</button>
        )}
        <button style={BTN} onClick={props.onDismiss}>dismiss</button>
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
