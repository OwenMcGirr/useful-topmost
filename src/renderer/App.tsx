import { useEffect, useState } from 'react';
import Dashboard from './Dashboard';
import SetupScreen from './SetupScreen';

export default function App() {
  const [codexAvailable, setCodexAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    window.api.codexAvailable().then(setCodexAvailable);
  }, []);

  if (codexAvailable === null) return <div style={{ padding: 24 }}>Checking Codex…</div>;
  if (!codexAvailable) return <SetupScreen />;
  return <Dashboard />;
}
