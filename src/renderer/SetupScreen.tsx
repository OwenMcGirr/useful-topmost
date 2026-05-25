export default function SetupScreen() {
  return (
    <div style={{ padding: 48, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>Codex CLI not found</h1>
      <p style={{ fontSize: 18, lineHeight: 1.5 }}>
        This dashboard generates each widget by invoking the OpenAI Codex CLI.
        Install it before continuing.
      </p>
      <pre style={{
        background: '#161b22', padding: 16, borderRadius: 6, fontSize: 16, marginTop: 16
      }}>
{`npm install -g @openai/codex
codex login`}
      </pre>
      <p style={{ marginTop: 16, opacity: 0.7 }}>
        Restart the app after installing.
      </p>
    </div>
  );
}
