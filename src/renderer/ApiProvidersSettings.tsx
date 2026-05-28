import { useEffect, useRef, useState } from 'react';
import type { PublicProvider, Provider, AuthStrategy } from '../main/secrets-store';
import { BTN, BTN_DANGER, BTN_PRIMARY, FIELD, INPUT, ROW } from './settingsStyles';

type HeaderScheme = 'none' | 'bearer' | 'basic' | 'token' | 'custom';

interface Draft {
  id: string;
  name: string;
  hostnamesText: string;
  authType: 'query' | 'header';
  param: string;
  headerName: string;
  headerScheme: HeaderScheme;
  headerCustomPrefix: string;
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
  headerScheme: 'none',
  headerCustomPrefix: '',
  value: '',
  editing: false
};

function schemeToPrefix(scheme: HeaderScheme, customPrefix: string): string | undefined {
  switch (scheme) {
    case 'none': return undefined;
    case 'bearer': return 'Bearer ';
    case 'basic': return 'Basic ';
    case 'token': return 'Token ';
    case 'custom': return customPrefix || undefined;
  }
}

function prefixToScheme(prefix: string | undefined): { scheme: HeaderScheme; custom: string } {
  if (!prefix) return { scheme: 'none', custom: '' };
  if (prefix === 'Bearer ') return { scheme: 'bearer', custom: '' };
  if (prefix === 'Basic ') return { scheme: 'basic', custom: '' };
  if (prefix === 'Token ') return { scheme: 'token', custom: '' };
  return { scheme: 'custom', custom: prefix };
}

type TestResult =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; ok: true; httpStatus: number }
  | { status: 'done'; ok: false; error: string };

function describeTestResult(result: TestResult): { text: string; color: string } | null {
  if (result.status === 'idle') return null;
  if (result.status === 'running') return { text: 'testing…', color: '#8b949e' };
  if (result.ok) {
    if (result.httpStatus === 401 || result.httpStatus === 403) {
      return { text: `HTTP ${result.httpStatus} — auth rejected`, color: '#f85149' };
    }
    return { text: `OK (HTTP ${result.httpStatus})`, color: '#3fb950' };
  }
  return { text: result.error, color: '#f85149' };
}

export default function ApiProvidersSettings() {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>('');
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookupSource, setLookupSource] = useState('');
  const [lookupElapsed, setLookupElapsed] = useState(0);
  const lookupStart = useRef<number | null>(null);

  useEffect(() => {
    if (!lookupBusy) {
      lookupStart.current = null;
      setLookupElapsed(0);
      return;
    }
    lookupStart.current = Date.now();
    setLookupElapsed(0);
    const interval = window.setInterval(() => {
      const start = lookupStart.current;
      if (start) setLookupElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(interval);
  }, [lookupBusy]);

  const refresh = async () => {
    setProviders(await window.api.secrets.list());
  };

  useEffect(() => {
    refresh();
    setDraft(null);
    setError('');
  }, []);

  const startAdd = () => {
    setDraft({ ...empty, id: crypto.randomUUID() });
    setError('');
    setLookupQuery('');
    setLookupError('');
    setLookupSource('');
  };

  const handleLookup = async () => {
    if (!draft) return;
    const query = lookupQuery.trim();
    if (!query || lookupBusy) return;
    setLookupBusy(true);
    setLookupError('');
    setLookupSource('');
    try {
      const result = await window.api.secrets.lookupProvider(query);
      if (!result.ok) {
        setLookupError(result.error);
        return;
      }
      const { provider } = result;
      if (!provider || !Array.isArray(provider.hostnames) || !provider.auth) {
        setLookupError(`unexpected response shape: ${JSON.stringify(result)}`);
        return;
      }
      setDraft({
        ...draft,
        name: provider.name,
        hostnamesText: provider.hostnames.join('\n'),
        authType: provider.auth.type,
        param: provider.auth.type === 'query' ? provider.auth.param : '',
        headerName: provider.auth.type === 'header' ? provider.auth.name : '',
        headerScheme: provider.auth.type === 'header' ? provider.auth.scheme : 'none',
        headerCustomPrefix: ''
      });
      setLookupSource(provider.source);
    } catch (e: any) {
      setLookupError(e?.message ?? String(e ?? 'unknown error'));
    } finally {
      setLookupBusy(false);
    }
  };

  const handleLookupCancel = async () => {
    await window.api.secrets.cancelLookup();
  };

  const startEdit = (p: PublicProvider) => {
    const existingPrefix = p.auth.type === 'header' ? p.auth.prefix : undefined;
    const { scheme, custom } = prefixToScheme(existingPrefix);
    setDraft({
      id: p.id,
      name: p.name,
      hostnamesText: p.hostnames.join('\n'),
      authType: p.auth.type,
      param: p.auth.type === 'query' ? p.auth.param : '',
      headerName: p.auth.type === 'header' ? p.auth.name : '',
      headerScheme: scheme,
      headerCustomPrefix: custom,
      value: '',
      editing: true
    });
    setError('');
  };

  const handleDelete = async (id: string) => {
    await window.api.secrets.delete(id);
    refresh();
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: { status: 'running' } }));
    const result = await window.api.secrets.test(id);
    setTestResults((prev) => ({
      ...prev,
      [id]: result.ok
        ? { status: 'done', ok: true, httpStatus: result.status }
        : { status: 'done', ok: false, error: result.error }
    }));
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
      const prefix = schemeToPrefix(draft.headerScheme, draft.headerCustomPrefix);
      auth = {
        type: 'header',
        name: draft.headerName.trim(),
        ...(prefix !== undefined ? { prefix } : {})
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
    <section>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>API providers</h2>

      {draft ? (
        <div>
          {!draft.editing && (
            <div style={FIELD}>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                Describe an API (Codex searches the official docs)
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  aria-label="Describe an API"
                  style={INPUT}
                  value={lookupQuery}
                  placeholder='e.g. "Stripe", "GitHub REST", "AlphaVantage"'
                  disabled={lookupBusy}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleLookup();
                    }
                  }}
                />
                {lookupBusy ? (
                  <button
                    style={{ ...BTN, whiteSpace: 'nowrap' }}
                    onClick={() => void handleLookupCancel()}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    style={{ ...BTN_PRIMARY, whiteSpace: 'nowrap', opacity: !lookupQuery.trim() ? 0.5 : 1 }}
                    disabled={!lookupQuery.trim()}
                    onClick={() => void handleLookup()}
                  >
                    Search
                  </button>
                )}
              </div>
              {lookupBusy && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8b949e', fontSize: 12, marginTop: 6 }}>
                  <span className="spinner" aria-hidden />
                  <span>Searching the official docs… {lookupElapsed}s</span>
                </div>
              )}
              {lookupError && <div style={{ color: '#f85149', fontSize: 12, marginTop: 6 }}>{lookupError}</div>}
              {lookupSource && (
                <div style={{ color: '#3fb950', fontSize: 12, marginTop: 6 }}>
                  Filled from: <a href={lookupSource} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>{lookupSource}</a>
                </div>
              )}
            </div>
          )}
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
                <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Scheme</span>
                <select style={INPUT} value={draft.headerScheme}
                  onChange={(e) => setDraft({ ...draft, headerScheme: e.target.value as HeaderScheme })}>
                  <option value="none">None</option>
                  <option value="bearer">Bearer</option>
                  <option value="basic">Basic</option>
                  <option value="token">Token</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {draft.headerScheme === 'custom' && (
                <label style={FIELD}>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Custom prefix (include any trailing space)</span>
                  <input style={INPUT} value={draft.headerCustomPrefix}
                    onChange={(e) => setDraft({ ...draft, headerCustomPrefix: e.target.value })} />
                </label>
              )}
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
              {providers.map((p) => {
                const result = testResults[p.id] ?? { status: 'idle' as const };
                const description = describeTestResult(result);
                return (
                  <div key={p.id} data-row style={ROW}>
                    <div>
                      <div style={{ fontSize: 14 }}>{p.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{p.hostnames.join(', ')}</div>
                      {description && (
                        <div style={{ fontSize: 12, color: description.color, marginTop: 4 }}>
                          {description.text}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        style={BTN}
                        disabled={result.status === 'running'}
                        onClick={() => handleTest(p.id)}
                      >
                        Test
                      </button>
                      <button style={BTN} onClick={() => startEdit(p)}>Edit</button>
                      <button style={BTN_DANGER} onClick={() => handleDelete(p.id)}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', marginTop: 16 }}>
            <button style={BTN_PRIMARY} onClick={startAdd}>Add provider</button>
          </div>
        </div>
      )}
    </section>
  );
}
