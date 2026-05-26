export const FIELD: React.CSSProperties = { display: 'block', marginBottom: 12 };

export const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 14,
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6
};

export const BTN: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13
};

export const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background: '#238636',
  borderColor: '#238636',
  color: '#fff'
};

export const BTN_DANGER: React.CSSProperties = { ...BTN, color: '#f85149' };

export const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 4px',
  borderBottom: '1px solid #21262d'
};
