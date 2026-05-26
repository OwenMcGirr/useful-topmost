import { useEffect, useState } from 'react';
import type { PublicProvider, Provider, AuthStrategy } from '../main/secrets-store';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Draft {
  id: string;
  name: string;
  hostnamesText: string;
  authType: 'query' | 'header';
  param: string;
  headerName: string;
  headerPrefix: string;
  value: string;
  editing: boolean;
}

const empty: Draft = {
  id: '',
  name: '',
  hostnamesText: '',
  authType: 'query',
  param: '',
  headerName: '',
  headerPrefix: '',
  value: '',
  editing: false
};

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
};
const PANEL: React.CSSProperties = {
  background: '#161b22', padding: 24, borderRadius: 8,
  width: 560, maxHeight: '80vh', overflowY: 'auto', color: '#e6edf3'
};
const FIELD: React.CSSProperties = { display: 'block', marginBottom: 12 };
const INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14,
  background: '#0d1117', color: '#e6edf3',
  border: '1px solid #30363d', borderRadius: 6
};
const BTN: React.CSSProperties = {
  padding: '6px 12px', background: 'transparent',
  color: '#e6edf3', border: '1px solid #30363d',
  borderRadius: 6, cursor: 'pointer', fontSize: 13
};
const BTN_PRIMARY: React.CSSProperties = { ...BTN, background: '#238636', borderColor: '#238636', color: '#fff' };
const BTN_DANGER: React.CSSProperties = { ...BTN, color: '#f85149' };
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 4px', borderBottom: '1px solid #21262d'
};

export default function SecretsModal({ open, onClose }: Props) {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>('');

  const refresh = async () => {
    setProviders(await window.api.secrets.list());
  };

  useEffect(() => {
    if (open) {
      refresh();
      setDraft(null);
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const startAdd = () => {
    setDraft({ ...empty, id: crypto.randomUUID() });
    setError('');
  };

  const startEdit = (p: PublicProvider) => {
    setDraft({
      id: p.id,
      name: p.name,
      hostnamesText: p.hostnames.join('\n'),
      authType: p.auth.type,
      param: p.auth.type === 'query' ? p.auth.param : '',
      headerName: p.auth.type === 'header' ? p.auth.name : '',
      headerPrefix: p.auth.type === 'header' ? (p.auth.prefix ?? '') : '',
      value: '',
      editing: true
    });
    setError('');
  };

  const handleDelete = async (id: string) => {
    await window.api.secrets.delete(id);
    refresh();
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError('name is required'); return; }
    const hostnames = draft.hostnamesText
      .split('\n').map((s) => s.trim()).filter(Boolean);
    if (hostnames.length === 0) { setError('at least one hostname is required'); return; }

    let auth: AuthStrategy;
    if (draft.authType === 'query') {
      if (!draft.param.trim()) { setError('param is required for query auth'); return; }
      auth = { type: 'query', param: draft.param.trim() };
    } else {
      if (!draft.headerName.trim()) { setError('header name is required'); return; }
      auth = {
        type: 'header',
        name: draft.headerName.trim(),
        ...(draft.headerPrefix ? { prefix: draft.headerPrefix } : {})
      };
    }
    if (!draft.editing && !draft.value) { setError('value is required'); return; }

    const result = await window.api.secrets.save({
      id: draft.id,
      name: draft.name.trim(),
      hostnames,
      auth,
      value: draft.value
    } as Provider);

    if (!result.ok) { setError(result.error ?? 'save failed'); return; }
    setDraft(null);
    setError('');
    refresh();
  };

  return (
    <div role="dialog" aria-modal style={OVERLAY}>
      <div style={PANEL}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>API providers</h2>

        {draft ? (
          <div>
            <label style={FIELD}>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Name</span>
              <input style={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label style={FIELD}>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Hostnames (one per line)</span>
              <textarea style={{ ...INPUT, height: 60, resize: 'vertical' }}
                value={draft.hostnamesText}
                onChange={(e) => setDraft({ ...draft, hostnamesText: e.target.value })} />
            </label>
            <label style={FIELD}>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Auth type</span>
              <select style={INPUT} value={draft.authType}
                onChange={(e) => setDraft({ ...draft, authType: e.target.value as 'query' | 'header' })}>
                <option value="query">Query string</option>
                <option value="header">Header</option>
              </select>
            </label>
            {draft.authType === 'query' ? (
              <label style={FIELD}>
                <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Param</span>
                <input style={INPUT} value={draft.param}
                  onChange={(e) => setDraft({ ...draft, param: e.target.value })} />
              </label>
            ) : (
              <>
                <label style={FIELD}>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Header name</span>
                  <input style={INPUT} value={draft.headerName}
                    onChange={(e) => setDraft({ ...draft, headerName: e.target.value })} />
                </label>
                <label style={FIELD}>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Prefix (optional, e.g. "Bearer ")</span>
                  <input style={INPUT} value={draft.headerPrefix}
                    onChange={(e) => setDraft({ ...draft, headerPrefix: e.target.value })} />
                </label>
              </>
            )}
            <label style={FIELD}>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Value</span>
              <input type="password" style={INPUT} value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
            </label>
            {draft.editing && (
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: -8, marginBottom: 12 }}>
                Leave blank to keep existing value.
              </div>
            )}

            {error && <div style={{ color: '#f85149', marginBottom: 12, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={BTN} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
              <button style={BTN_PRIMARY} onClick={handleSave}>Save</button>
            </div>
          </div>
        ) : (
          <div>
            {providers.length === 0 ? (
              <div style={{ padding: '16px 0', opacity: 0.7 }}>No providers yet.</div>
            ) : (
              <div>
                {providers.map((p) => (
                  <div key={p.id} data-row style={ROW}>
                    <div>
                      <div style={{ fontSize: 14 }}>{p.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{p.hostnames.join(', ')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button style={BTN} onClick={() => startEdit(p)}>Edit</button>
                      <button style={BTN_DANGER} onClick={() => handleDelete(p.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
              <button style={BTN_PRIMARY} onClick={startAdd}>Add provider</button>
              <button style={BTN} onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
