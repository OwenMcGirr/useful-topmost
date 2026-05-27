import { useState } from 'react';
import type { UpdateState } from '../preload';

interface Props {
  state: UpdateState;
}

const BANNER: React.CSSProperties = {
  position: 'fixed',
  left: 32,
  bottom: 32,
  zIndex: 60,
  minWidth: 260,
  maxWidth: 360,
  padding: 12,
  background: '#161b22',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 8,
  boxShadow: '0 12px 32px rgba(0,0,0,0.35)'
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  justifyContent: 'space-between'
};

const BUTTON: React.CSSProperties = {
  padding: '6px 10px',
  background: 'transparent',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13
};

const PRIMARY: React.CSSProperties = {
  ...BUTTON,
  background: '#238636',
  borderColor: '#238636',
  color: '#fff'
};

export default function UpdatePrompt({ state }: Props) {
  const promptKey = state.status === 'downloaded'
    ? `downloaded:${state.version}`
    : state.status === 'error'
      ? 'error'
      : state.status;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  if (
    dismissedKey === promptKey ||
    (state.status !== 'downloaded' && state.status !== 'downloading' && state.status !== 'error')
  ) {
    return null;
  }

  if (state.status === 'downloaded') {
    return (
      <div role="status" style={BANNER}>
        <div style={ROW}>
          <div>Update {state.version} ready</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={PRIMARY} onClick={() => void window.api.updates.restart()}>Restart</button>
            <button style={BUTTON} onClick={() => setDismissedKey(promptKey)}>Later</button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'downloading') {
    const percent = typeof state.percent === 'number' ? ` ${Math.round(state.percent)}%` : '';
    return (
      <div role="status" style={BANNER}>
        Downloading update{percent}
      </div>
    );
  }

  return (
    <div role="status" style={BANNER}>
      <div style={ROW}>
        <div>Update check failed</div>
        <button style={BUTTON} onClick={() => setDismissedKey(promptKey)}>Dismiss</button>
      </div>
    </div>
  );
}
