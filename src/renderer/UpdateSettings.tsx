import { useEffect, useState } from 'react';
import type { UpdateChannel, UpdateState } from '../preload';
import { BTN } from './settingsStyles';

interface Props {
  updateState: UpdateState;
  onCheckUpdates: () => void;
  onRestartUpdate: () => void;
}

const PRIMARY_BTN: React.CSSProperties = {
  ...BTN,
  background: '#238636',
  borderColor: '#238636',
  color: '#fff'
};

const SELECT: React.CSSProperties = {
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13
};

function terminalError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Could not save update channel.';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking…';
    case 'available':
      return `Update ${state.version} available.`;
    case 'downloading':
      return typeof state.percent === 'number'
        ? `Downloading ${Math.round(state.percent)}%`
        : 'Downloading…';
    case 'downloaded':
      return `Update ${state.version} ready.`;
    case 'not-available':
      return 'Up to date.';
    case 'unsupported':
      return 'Updates unavailable for this package.';
    case 'error':
      return 'Update check failed.';
    default:
      return 'Idle.';
  }
}

export default function UpdateSettings({ updateState, onCheckUpdates, onRestartUpdate }: Props) {
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>('stable');
  const [channelError, setChannelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.prefs.get().then((prefs) => {
      if (!cancelled) setUpdateChannel(prefs.updateChannel);
    });
    return () => { cancelled = true; };
  }, []);

  const handleChannelChange = async (next: UpdateChannel) => {
    const previous = updateChannel;
    setUpdateChannel(next);
    setChannelError(null);
    const result = await window.api.prefs.setUpdateChannel(next);
    if (!result.ok) {
      setUpdateChannel(previous);
      setChannelError(terminalError(result.error ?? 'Could not save update channel'));
    }
  };

  const checkBusy =
    updateState.status === 'checking' ||
    updateState.status === 'downloading' ||
    updateState.status === 'downloaded';
  const checkStyle: React.CSSProperties = checkBusy
    ? { ...BTN, opacity: 0.5, cursor: 'not-allowed' }
    : BTN;
  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Updates</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <label htmlFor="update-channel" style={{ display: 'block', fontSize: 14 }}>Update channel</label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {updateChannel === 'prerelease' ? 'Release candidates and stable releases.' : 'Stable releases only.'}
          </div>
          {channelError && (
            <div role="alert" style={{ marginTop: 6, color: '#f85149', fontSize: 12 }}>{channelError}</div>
          )}
        </div>
        <select
          id="update-channel"
          aria-label="Update channel"
          value={updateChannel}
          style={SELECT}
          onChange={(event) => void handleChannelChange(event.target.value as UpdateChannel)}
        >
          <option value="stable">Stable</option>
          <option value="prerelease">Prerelease</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14 }}>Release status</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{updateStatusText(updateState)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={checkStyle} disabled={checkBusy} onClick={onCheckUpdates}>Check for updates</button>
          {updateState.status === 'downloaded' && (
            <button style={PRIMARY_BTN} onClick={onRestartUpdate}>Restart to update</button>
          )}
        </div>
      </div>
    </section>
  );
}
