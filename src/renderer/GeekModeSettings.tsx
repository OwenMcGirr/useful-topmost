import { useEffect, useState } from 'react';

export default function GeekModeSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void window.api.prefs.get().then((p) => setEnabled(p.geekMode));
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    const result = await window.api.prefs.setGeekMode(next);
    if (!result.ok) setEnabled(!next);
  };

  if (enabled === null) {
    return (
      <section>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Geek Mode</h2>
        <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
      </section>
    );
  }

  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Geek Mode</h2>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          aria-label="Show data source info on each tile"
        />
        <span>Show data source info on each tile</span>
      </label>
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12, lineHeight: 1.5 }}>
        When on, each tile gets an info icon you can click to see the data sources
        Codex recorded while building the widget — things like &ldquo;Open-Meteo&rdquo;
        or &ldquo;Hacker News API&rdquo;.
      </p>
    </section>
  );
}
