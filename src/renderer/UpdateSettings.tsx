import type { UpdateState } from '../preload';
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

function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking';
    case 'available':
      return `Update ${state.version} available`;
    case 'downloading':
      return typeof state.percent === 'number'
        ? `Downloading ${Math.round(state.percent)}%`
        : 'Downloading';
    case 'downloaded':
      return `Update ${state.version} ready`;
    case 'not-available':
      return 'Up to date';
    case 'unsupported':
      return 'Updates unavailable for this package';
    case 'error':
      return 'Update check failed';
    default:
      return 'Idle';
  }
}

export default function UpdateSettings({ updateState, onCheckUpdates, onRestartUpdate }: Props) {
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
