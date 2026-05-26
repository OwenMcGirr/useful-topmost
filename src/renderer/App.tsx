import { useEffect, useState } from 'react';
import Dashboard from './Dashboard';
import SetupScreen from './SetupScreen';
import type { CodexStatus } from '../preload';

export default function App() {
  const [status, setStatus] = useState<CodexStatus | null>(null);

  useEffect(() => {
    window.api.codexStatus().then(setStatus);
  }, []);

  if (status === null) return <div style={{ padding: 24 }}>Checking Codex…</div>;
  if (!status.installed) return <SetupScreen mode="install" />;
  if (!status.authenticated) return <SetupScreen mode="login" />;
  return <Dashboard />;
}
