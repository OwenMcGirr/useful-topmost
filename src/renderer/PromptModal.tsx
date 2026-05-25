import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  initialValue?: string;
  onSubmit: (prompt: string) => void;
  onClose: () => void;
}

export default function PromptModal({ open, initialValue = '', onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div role="dialog" aria-modal style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div style={{
        background: '#161b22', padding: 24, borderRadius: 8, width: 520, color: '#e6edf3'
      }}>
        <label style={{ display: 'block', fontSize: 14, opacity: 0.7, marginBottom: 8 }}>
          What should this widget show?
        </label>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          style={{
            width: '100%', padding: '12px 14px', fontSize: 18,
            background: '#0d1117', color: '#e6edf3',
            border: '1px solid #30363d', borderRadius: 6
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', background: 'transparent',
            color: '#e6edf3', border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer'
          }}>Cancel</button>
          <button onClick={submit} style={{
            padding: '8px 16px', background: '#238636',
            color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer'
          }}>Create</button>
        </div>
      </div>
    </div>
  );
}
