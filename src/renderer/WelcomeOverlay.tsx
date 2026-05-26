export const EXAMPLE_PROMPTS: readonly string[] = [
  'a digital clock showing local time, updating every second',
  'Hacker News top 5 stories with comment count, refreshing every 5 minutes',
  "today's NASA picture of the day with caption — needs a NASA provider"
];

interface Props {
  onDismiss: () => void;
  onUseExample: (prompt: string) => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 40
};

const PANEL: React.CSSProperties = {
  pointerEvents: 'auto',
  width: 'min(640px, 88vw)',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 12,
  padding: 32,
  color: '#e6edf3',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45)'
};

const HEADLINE: React.CSSProperties = {
  fontSize: 24,
  margin: '0 0 12px',
  fontWeight: 600
};

const INTRO: React.CSSProperties = {
  margin: '0 0 20px',
  fontSize: 15,
  lineHeight: 1.5,
  opacity: 0.85
};

const CHIP_LABEL: React.CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  opacity: 0.6,
  margin: '0 0 8px'
};

const CHIP_LIST: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 20
};

const CHIP: React.CSSProperties = {
  textAlign: 'left',
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 14,
  cursor: 'pointer'
};

const FOOTER: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end'
};

const DISMISS: React.CSSProperties = {
  background: 'transparent',
  color: '#8b949e',
  border: 0,
  cursor: 'pointer',
  fontSize: 13,
  padding: '4px 8px'
};

export default function WelcomeOverlay({ onDismiss, onUseExample }: Props) {
  return (
    <div style={OVERLAY} role="dialog" aria-label="welcome">
      <div style={PANEL}>
        <h1 style={HEADLINE}>Welcome to useful-topmost</h1>
        <p style={INTRO}>
          Hit the green <strong>+</strong> button (bottom-right) and tell it what
          widget you want — a clock, a stock ticker, your GitHub run status.
          Codex writes the code; this app runs it in a sandboxed tile that
          refreshes itself.
        </p>
        <p style={CHIP_LABEL}>Try one of these</p>
        <div style={CHIP_LIST}>
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              style={CHIP}
              onClick={() => onUseExample(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
        <div style={FOOTER}>
          <button style={DISMISS} onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
