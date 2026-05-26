interface Props {
  mode: 'install' | 'login';
}

const PAGE: React.CSSProperties = { padding: 48, maxWidth: 720, margin: '0 auto' };
const HEADING: React.CSSProperties = { fontSize: 32, marginBottom: 16 };
const PARA: React.CSSProperties = { fontSize: 18, lineHeight: 1.5 };
const CODE: React.CSSProperties = {
  background: '#161b22', padding: 16, borderRadius: 6, fontSize: 16, marginTop: 16
};
const FOOTER: React.CSSProperties = { marginTop: 16, opacity: 0.7 };

export default function SetupScreen({ mode }: Props) {
  if (mode === 'login') {
    return (
      <div style={PAGE}>
        <h1 style={HEADING}>Codex is installed but not logged in</h1>
        <p style={PARA}>
          The OpenAI Codex CLI is on your PATH but no account is signed in.
          Log in so widgets can be generated.
        </p>
        <pre style={CODE}>{`codex login`}</pre>
        <p style={FOOTER}>Restart the app after logging in.</p>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <h1 style={HEADING}>Codex CLI not found</h1>
      <p style={PARA}>
        This dashboard generates each widget by invoking the OpenAI Codex CLI.
        Install it before continuing.
      </p>
      <pre style={CODE}>{`npm install -g @openai/codex
codex login`}</pre>
      <p style={FOOTER}>Restart the app after installing.</p>
    </div>
  );
}
