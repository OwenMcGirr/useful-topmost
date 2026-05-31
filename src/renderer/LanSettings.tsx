import { useEffect, useState } from 'react';
import type { LanServerState } from '../main/lan-server';
import { BTN_PRIMARY, FIELD, INPUT } from './settingsStyles';

interface LanPrefs {
  enabled: boolean;
  port: number;
}

const DEFAULT_PREFS: LanPrefs = { enabled: false, port: 32177 };

function normalizeState(state: LanServerState | null): LanServerState {
  return state ?? { running: false, port: DEFAULT_PREFS.port, urls: [] };
}

export default function LanSettings() {
  const [prefs, setPrefs] = useState<LanPrefs | null>(null);
  const [state, setState] = useState<LanServerState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshState = async () => {
    setState(await window.api.lan.getState());
  };

  useEffect(() => {
    void (async () => {
      const current = await window.api.prefs.get();
      setPrefs(current.lanServer ?? DEFAULT_PREFS);
      await refreshState();
    })();
  }, []);

  const save = async (next: LanPrefs) => {
    if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) {
      setError('Port must be between 1024 and 65535.');
      return;
    }

    const previous = prefs ?? DEFAULT_PREFS;
    setPrefs(next);
    setSaving(true);
    setError(null);
    const result = await window.api.prefs.setLanServer(next);
    if (!result.ok) {
      setPrefs(previous);
      setError(result.error.endsWith('.') ? result.error : `${result.error}.`);
    }
    await refreshState();
    setSaving(false);
  };

  if (prefs === null) {
    return (
      <section>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Local network</h2>
        <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
      </section>
    );
  }

  const currentState = normalizeState(state);

  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Local network</h2>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => void save({ ...prefs, enabled: e.target.checked })}
          aria-label="Serve dashboard on local network"
        />
        <span>Serve dashboard on local network</span>
      </label>

      <label style={FIELD}>
        Port
        <input
          style={{ ...INPUT, marginTop: 6 }}
          type="number"
          min={1024}
          max={65535}
          value={prefs.port}
          onChange={(e) => setPrefs({ ...prefs, port: Number(e.target.value) })}
          aria-label="Port"
        />
      </label>

      <button style={BTN_PRIMARY} onClick={() => void save(prefs)} disabled={saving}>
        {saving ? 'Saving…' : 'Save local network settings'}
      </button>

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12, lineHeight: 1.5 }}>
        Anyone on this network can view the dashboard while this is on.
      </p>

      {error && <p role="alert" style={{ color: '#f85149', fontSize: 13 }}>{error}</p>}
      {!error && currentState.error && (
        <p role="alert" style={{ color: '#f85149', fontSize: 13 }}>
          {currentState.error.endsWith('.') ? currentState.error : `${currentState.error}.`}
        </p>
      )}
      {!error && !currentState.error && currentState.running && (
        <div style={{ fontSize: 13, marginTop: 12 }}>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>Available at</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {currentState.urls.map((url) => <li key={url}>{url}</li>)}
          </ul>
        </div>
      )}
      {!error && !currentState.error && !currentState.running && (
        <p style={{ fontSize: 13, opacity: 0.7 }}>Local network access is off.</p>
      )}
    </section>
  );
}
