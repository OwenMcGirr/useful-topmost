import { useState } from 'react';
import type { UpdateState } from '../preload';
import ApiProvidersSettings from './ApiProvidersSettings';
import GeekModeSettings from './GeekModeSettings';
import UpdateSettings from './UpdateSettings';
import { BTN } from './settingsStyles';

type Section = 'providers' | 'geek' | 'updates';

interface Props {
  open: boolean;
  onClose: () => void;
  updateState?: UpdateState;
  onCheckUpdates?: () => void;
  onRestartUpdate?: () => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100
};

const PANEL: React.CSSProperties = {
  background: '#161b22',
  width: 720,
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: '80vh',
  color: '#e6edf3',
  borderRadius: 8,
  border: '1px solid #30363d',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column'
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '18px 20px',
  borderBottom: '1px solid #21262d'
};

const BODY: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px minmax(0, 1fr)',
  minHeight: 360,
  overflow: 'hidden'
};

const SIDEBAR: React.CSSProperties = {
  padding: 12,
  borderRight: '1px solid #21262d',
  background: '#0d1117'
};

const CONTENT: React.CSSProperties = {
  padding: 20,
  overflowY: 'auto'
};

function sidebarButton(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    marginBottom: 4,
    border: '1px solid transparent',
    borderRadius: 6,
    background: active ? '#21262d' : 'transparent',
    color: '#e6edf3',
    cursor: 'pointer',
    fontSize: 13
  };
}

export default function SettingsModal({
  open,
  onClose,
  updateState = { status: 'idle' },
  onCheckUpdates = () => {},
  onRestartUpdate = () => {}
}: Props) {
  const [section, setSection] = useState<Section>('providers');

  if (!open) return null;

  return (
    <div role="dialog" aria-modal style={OVERLAY}>
      <div style={PANEL}>
        <div style={HEADER}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Settings</h1>
          <button aria-label="Close settings" style={BTN} onClick={onClose}>Close</button>
        </div>
        <div style={BODY}>
          <nav aria-label="Settings sections" style={SIDEBAR}>
            <button
              style={sidebarButton(section === 'providers')}
              aria-current={section === 'providers' ? 'page' : undefined}
              onClick={() => setSection('providers')}
            >
              API Providers
            </button>
            <button
              style={sidebarButton(section === 'geek')}
              aria-current={section === 'geek' ? 'page' : undefined}
              onClick={() => setSection('geek')}
            >
              Geek Mode
            </button>
            <button
              style={sidebarButton(section === 'updates')}
              aria-current={section === 'updates' ? 'page' : undefined}
              onClick={() => setSection('updates')}
            >
              Updates
            </button>
          </nav>
          <div style={CONTENT}>
            {section === 'providers' && <ApiProvidersSettings />}
            {section === 'geek' && <GeekModeSettings />}
            {section === 'updates' && (
              <UpdateSettings
                updateState={updateState}
                onCheckUpdates={onCheckUpdates}
                onRestartUpdate={onRestartUpdate}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
