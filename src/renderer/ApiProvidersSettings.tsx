import { useEffect, useState } from 'react';
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

interface Preset {
  id: string;
  label: string;
  name: string;
  hostnames: string[];
  authType: 'query' | 'header';
  param?: string;
  headerName?: string;
  headerScheme?: HeaderScheme;
}

const PRESETS: Preset[] = [
  {
    id: 'openweather', label: 'OpenWeather',
    name: 'OpenWeather', hostnames: ['api.openweathermap.org', 'pro.openweathermap.org'],
    authType: 'query', param: 'appid'
  },
  {
    id: 'nasa', label: 'NASA',
    name: 'NASA', hostnames: ['api.nasa.gov'],
    authType: 'query', param: 'api_key'
  },
  {
    id: 'alphavantage', label: 'AlphaVantage',
    name: 'AlphaVantage', hostnames: ['www.alphavantage.co'],
    authType: 'query', param: 'apikey'
  },
  {
    id: 'mapbox', label: 'Mapbox',
    name: 'Mapbox', hostnames: ['api.mapbox.com'],
    authType: 'query', param: 'access_token'
  },
  {
    id: 'openai', label: 'OpenAI',
    name: 'OpenAI', hostnames: ['api.openai.com'],
    authType: 'header', headerName: 'Authorization', headerScheme: 'bearer'
  },
  {
    id: 'anthropic', label: 'Anthropic',
    name: 'Anthropic', hostnames: ['api.anthropic.com'],
    authType: 'header', headerName: 'x-api-key', headerScheme: 'none'
  },
  {
    id: 'newsapi', label: 'News API',
    name: 'News API', hostnames: ['newsapi.org'],
    authType: 'header', headerName: 'X-API-Key', headerScheme: 'none'
  }
];

function applyPreset(draft: Draft, preset: Preset): Draft {
  return {
    ...draft,
    name: preset.name,
    hostnamesText: preset.hostnames.join('\n'),
    authType: preset.authType,
    param: preset.param ?? '',
    headerName: preset.headerName ?? '',
    headerScheme: preset.headerScheme ?? 'none',
    headerCustomPrefix: ''
  };
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
      <h2 style={{ marginTop: 0, fontSize: 18 }}>API Providers</h2>

      {draft ? (
        <div>
          {!draft.editing && (
            <label style={FIELD}>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Start from preset (optional)</span>
              <select
                style={INPUT}
                value=""
                onChange={(e) => {
                  const preset = PRESETS.find((p) => p.id === e.target.value);
                  if (preset) setDraft(applyPreset(draft, preset));
                }}
              >
                <option value="">— choose a preset —</option>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
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
