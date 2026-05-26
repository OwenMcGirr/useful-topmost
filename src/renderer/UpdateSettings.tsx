import type { UpdateState } from '../preload';
import { BTN } from './settingsStyles';

interface Props {
  updateState: UpdateState;
  onCheckUpdates: () => void;
}

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

export default function UpdateSettings({ updateState, onCheckUpdates }: Props) {
  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Updates</h2>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14 }}>Release status</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{updateStatusText(updateState)}</div>
        </div>
        <button style={BTN} onClick={onCheckUpdates}>Check for updates</button>
      </div>
    </section>
  );
}
