import { useEffect, useState } from 'react';
import Dashboard from './Dashboard';
import SetupScreen from './SetupScreen';
import type { CodexStatus } from '../preload';

export default function App() {
  const [status, setStatus] = useState<CodexStatus | null>(null);

  useEffect(() => {
    window.api.codexStatus().then(setStatus);
  }, []);

  if (status === null) return (
    <div role="status" style={{ padding: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
      <span className="spinner" aria-hidden />
      <span>Checking Codex…</span>
    </div>
  );
  if (!status.installed) return <SetupScreen mode="install" />;
  if (!status.authenticated) return <SetupScreen mode="login" />;
  return <Dashboard />;
}
