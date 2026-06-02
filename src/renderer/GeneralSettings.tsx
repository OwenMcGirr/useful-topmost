import { useEffect, useState } from 'react';
import type { StartupState } from '../preload';

function sentenceError(message: string): string {
  return message.endsWith('.') ? message : `${message}.`;
}

export default function GeneralSettings() {
  const [state, setState] = useState<StartupState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.api.startup.get().then(setState);
  }, []);

  const toggle = async (next: boolean) => {
    if (!state) return;
    const previous = state;
    setState({ ...state, enabled: next });
    setSaving(true);
    setError(null);
    const result = await window.api.startup.setEnabled(next);
    if (result.ok) {
      setState(result.state);
    } else {
      setState(result.state ?? previous);
      setError(sentenceError(result.error));
    }
    setSaving(false);
  };

  if (state === null) {
    return (
      <section>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>General</h2>
        <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
      </section>
    );
  }

  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>General</h2>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: state.supported ? 'pointer' : 'default' }}>
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={!state.supported || saving}
          onChange={(e) => void toggle(e.target.checked)}
          aria-label="Start with system"
        />
        <span>Start with system</span>
      </label>
      {!state.supported && (
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 12 }}>
          Start with system is not available on this system.
        </p>
      )}
      {error && <p role="alert" style={{ color: '#f85149', fontSize: 13 }}>{error}</p>}
    </section>
  );
}
