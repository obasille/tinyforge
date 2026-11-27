// The AI panel: a chat with the code agent (editor-core/src/ai) about the
// current game, and the AI settings. Loaded only when the panel opens, so
// the rest of the editor does not carry the AI code.
//
// The settings (provider and model, effort, show cost) are a preference of
// this browser, saved in localStorage; the dev server's .env sets which
// providers there are and the default model. No API key reaches the page.
//
// The deployed editor answers the same routes with a PHP proxy
// (apps/editor/server/ai/index.php) that holds the key; the panel then asks
// for its password first.

import { createStore } from '@tinyforge/editor-core';
import {
  Agent,
  type AiProvider,
  type AiStatus,
  aiLogin,
  aiLogout,
  type ChatItem,
  type ChatSettings,
  ClaudeProvider,
  type Effort,
  type FileChangeView,
  fetchAiStatus,
  lineDiff,
  OpenAiProvider,
  readSdkApi,
  systemPrompt,
} from '@tinyforge/editor-core/ai';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import guide from '../../../../AGENTS.md?raw';
import { useEditor } from '../EditorContext.ts';
import type { Editor } from '../editor.ts';
import { useStore } from '../hooks.ts';

const SETTINGS_KEY = 'tinyforge.editor.ai';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface AiSettings extends ChatSettings {
  /** The provider's id in the dev server's status ('anthropic', 'openai'). */
  provider: string;
  showCost: boolean;
  /** The AI may change only the current game's files (it can read every game's). */
  onlyGame: boolean;
}

function loadSettings(): Partial<AiSettings> {
  try {
    return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<AiSettings> | null) ?? {};
  } catch {
    return {};
  }
}

/** Saved settings; the model is filled in from the dev server's default once known. */
const settings = createStore<AiSettings>({
  provider: '',
  model: '',
  effort: 'medium',
  showCost: true,
  onlyGame: true,
  ...loadSettings(),
});
settings.subscribe(() => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.getState()));
  } catch {
    // Storage may be unavailable; the settings still apply for this session.
  }
});

type ProviderStatus = AiStatus['providers'][number];

const makeProvider = (p: ProviderStatus): AiProvider =>
  p.id === 'openai' ? new OpenAiProvider(location.origin, p.models) : new ClaudeProvider(location.origin);

/** One conversation per game and provider, kept while the page is open. */
const agents = new Map<string, Agent>();
let system: Promise<ReturnType<typeof systemPrompt>> | null = null;

async function agentFor(editor: Editor, game: string, provider: ProviderStatus): Promise<Agent> {
  const key = `${provider.id}/${game}`;
  const existing = agents.get(key);
  if (existing) return existing;
  system ??= readSdkApi(editor.files).then((sdk) => systemPrompt(guide, sdk));
  const agent = new Agent({
    provider: makeProvider(provider),
    settings: () => settings.getState(),
    system: await system,
    commands: editor.commands,
    buildStatus: () => editor.compiler.builds.getState()[game]?.status ?? 'not built',
    context: {
      files: editor.files,
      game,
      onlyGame: () => settings.getState().onlyGame,
      build: (g) => editor.compiler.build(g),
      invalidate: (changes) => editor.compiler.invalidate(changes),
      gameLog: () => {
        const lines = editor.logs
          .getState()
          .slice(-40)
          .map((e) => `[${e.kind}] ${e.message}`);
        return `Status: ${editor.host.session.getState().status}\nRecent log:\n${lines.join('\n') || '(empty)'}`;
      },
      assets: () => editor.assets.state.getState().assets,
    },
  });
  agents.set(key, agent);
  return agent;
}

export default function AiPanel() {
  const editor = useEditor();
  const game = useStore(editor.project).game;
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [agent, setAgent] = useState<Agent | null>(null);
  const { provider: providerId, onlyGame } = useStore(settings);
  const provider = status?.providers.find((p) => p.id === providerId) ?? null;

  const [checks, setChecks] = useState(0);
  const recheck = () => setChecks((n) => n + 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `checks` asks again after a login or logout
  useEffect(() => {
    void fetchAiStatus().then((s) => {
      setStatus(s);
      // Keep the saved choice while the dev server still offers it.
      const { provider: id, model } = settings.getState();
      const saved = s?.providers.find((p) => p.id === id);
      if (saved?.models.includes(model)) return;
      const first = saved ?? s?.providers[0];
      if (first) settings.setState((x) => ({ ...x, provider: first.id, model: first.defaultModel }));
    });
  }, [checks]);

  useEffect(() => {
    setAgent(null);
    if (!game || !provider) return;
    let live = true;
    void agentFor(editor, game, provider).then((a) => live && setAgent(a));
    return () => {
      live = false;
    };
  }, [editor, game, provider]);

  const newChat = () => {
    if (!game || !provider || agent?.state.getState().running) return;
    agents.delete(`${provider.id}/${game}`);
    void agentFor(editor, game, provider).then(setAgent);
  };

  let notice: string | null = null;
  if (status?.login) {
    return (
      <div className="tf-ai" data-testid="ai-panel">
        <AiLoginForm onDone={recheck} />
      </div>
    );
  }
  if (status === null) notice = 'AI needs the dev server (pnpm dev), or the AI proxy of the deployed editor.';
  else if (status && status.providers.length === 0) notice = status.reason ?? 'AI is not set up.';
  else if (!game) notice = 'Pick a game first.';

  return (
    <div className="tf-ai" data-testid="ai-panel">
      <Settings
        status={status ?? null}
        onNewChat={newChat}
        onLogout={status?.session ? () => void aiLogout().then(recheck) : null}
      />
      {game && !notice ? (
        <div className="tf-ai-scope" data-testid="ai-scope">
          Working on <strong>{game}</strong>
          <label title="Off: the AI may also change other games' files (for a refactor across games). It can always read them.">
            <input
              type="checkbox"
              data-testid="ai-only-game"
              checked={onlyGame}
              onChange={(e) => settings.setState((x) => ({ ...x, onlyGame: e.target.checked }))}
            />
            Only change this game
          </label>
        </div>
      ) : null}
      {status?.reason && status.providers.length > 0 ? (
        <div className="tf-ai-error" role="alert" data-testid="ai-setup-problem">
          {status.reason}
        </div>
      ) : null}
      {notice ? (
        <div className="tf-ai-notice" data-testid="ai-notice">
          {notice}
        </div>
      ) : agent ? (
        <Conversation agent={agent} />
      ) : null}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI-compatible (.env)' };

/**
 * The proxy's login: a real form with a username and a password field, so the
 * browser's password manager offers to save the password and fills it in.
 */
function AiLoginForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    aiLogin(password)
      .then((problem) => {
        if (problem) setError(problem);
        else onDone();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return (
    <form className="tf-ai-login" data-testid="ai-login" onSubmit={submit}>
      <p>Log in to use the AI. The API key stays on the server.</p>
      <label>
        Name
        <input type="text" name="username" autoComplete="username" value="TinyForge AI" readOnly />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          data-testid="ai-login-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
        />
      </label>
      {error ? (
        <div className="tf-ai-error" role="alert" data-testid="ai-login-error">
          {error}
        </div>
      ) : null}
      <button type="submit" data-testid="ai-login-submit" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}

function Settings({
  status,
  onNewChat,
  onLogout,
}: {
  status: AiStatus | null;
  onNewChat: () => void;
  onLogout: (() => void) | null;
}) {
  const s = useStore(settings);
  const providers = status?.providers ?? [];
  // A provider's id never has a ':'; a model's name may (llama3.1:8b).
  const choose = (value: string) => {
    const at = value.indexOf(':');
    settings.setState((x) => ({ ...x, provider: value.slice(0, at), model: value.slice(at + 1) }));
  };
  return (
    <div className="tf-ai-settings">
      <label>
        Model
        <select
          data-testid="ai-model"
          value={`${s.provider}:${s.model}`}
          disabled={providers.length === 0}
          onChange={(e) => choose(e.target.value)}
        >
          {providers.map((p) => (
            <optgroup key={p.id} label={PROVIDER_LABELS[p.id] ?? p.id}>
              {p.models.map((m) => (
                <option key={m} value={`${p.id}:${m}`}>
                  {m}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label title="More effort thinks longer: better on hard requests, slower and costlier (Claude only)">
        Effort
        <select
          data-testid="ai-effort"
          disabled={s.provider !== 'anthropic'}
          value={s.effort}
          onChange={(e) => settings.setState((x) => ({ ...x, effort: e.target.value as Effort }))}
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.showCost}
          onChange={(e) => settings.setState((x) => ({ ...x, showCost: e.target.checked }))}
        />
        Show cost
      </label>
      <span className="tf-spacer" />
      <button type="button" onClick={onNewChat} title="Forget this conversation and start a new one">
        New chat
      </button>
      {onLogout ? (
        <button type="button" data-testid="ai-logout" onClick={onLogout} title="Log out of the AI on this device">
          Log out
        </button>
      ) : null}
    </div>
  );
}

const money = (cost: number | null) => (cost === null ? 'cost unknown' : `$${cost.toFixed(cost < 0.1 ? 3 : 2)}`);

function Conversation({ agent }: { agent: Agent }) {
  const state = useStore(agent.state);
  const { showCost } = useStore(settings);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the items change
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.items]);

  const send = () => {
    if (state.running || !draft.trim()) return;
    void agent.ask(draft);
    setDraft('');
  };

  return (
    <>
      <div className="tf-ai-items" ref={listRef} data-testid="ai-items">
        {state.items.length === 0 ? (
          <div className="tf-ai-notice">Ask for a change to this game. Each request is one undo step.</div>
        ) : null}
        {state.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items are only appended or updated in place
          <Item key={i} item={item} showCost={showCost} agent={agent} />
        ))}
      </div>
      <div className="tf-ai-input">
        <textarea
          data-testid="ai-input"
          value={draft}
          placeholder="Ask for a change (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="tf-ai-actions">
          {showCost ? <span className="tf-ai-cost">{money(state.cost)}</span> : null}
          {state.running ? (
            <button type="button" data-testid="ai-stop" onClick={() => agent.stop()}>
              Stop
            </button>
          ) : (
            <button type="button" data-testid="ai-send" disabled={!draft.trim()} onClick={send}>
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Item({ item, showCost, agent }: { item: ChatItem; showCost: boolean; agent: Agent }) {
  switch (item.kind) {
    case 'user':
      return <div className="tf-ai-user">{item.text}</div>;
    case 'thinking':
      return (
        <details className="tf-ai-thinking" data-testid="ai-thinking">
          <summary>Thinking</summary>
          {item.text}
        </details>
      );
    case 'assistant':
      return item.text ? <div className="tf-ai-assistant">{item.text}</div> : <div className="tf-ai-step">…</div>;
    case 'step':
      return <div className={`tf-ai-step${item.ok ? '' : ' tf-ai-bad'}`}>{`${item.ok ? '✓' : '✗'} ${item.text}`}</div>;
    case 'error':
      return (
        <div className="tf-ai-error" role="alert">
          {item.text}
        </div>
      );
    case 'confirm':
      return (
        <div className="tf-ai-confirm" data-testid="ai-confirm">
          {item.text}
          {item.answer === null ? (
            <span className="tf-ai-confirm-actions">
              <button type="button" data-testid="ai-confirm-yes" onClick={() => agent.answer(true)}>
                Replace
              </button>
              <button type="button" data-testid="ai-confirm-no" onClick={() => agent.answer(false)}>
                Keep
              </button>
            </span>
          ) : (
            <span className="tf-ai-confirm-answer">{item.answer ? ' Replaced.' : ' Kept.'}</span>
          )}
        </div>
      );
    case 'changes':
      return (
        <div className="tf-ai-changes" data-testid="ai-changes">
          {item.files.map((f) => (
            <FileDiff key={f.path} file={f} />
          ))}
          {showCost ? <div className="tf-ai-step">{`This request: ${money(item.cost)}`}</div> : null}
        </div>
      );
  }
}

function FileDiff({ file }: { file: FileChangeView }) {
  const editor = useEditor();
  const verb = file.before === null ? 'created' : file.after === null ? 'deleted' : 'changed';
  const title = (
    <>
      {`${file.path} (${verb})`}
      {file.after !== null ? (
        <button type="button" onClick={() => editor.workbench.openFile(file.path)}>
          Open
        </button>
      ) : null}
    </>
  );
  // An image or a sound has no diff: its name and Open are enough.
  if (file.binary) return <div className="tf-ai-file">{title}</div>;
  return (
    <details className="tf-ai-file">
      <summary>{title}</summary>
      <pre className="tf-ai-diff">
        {lineDiff(file.before, file.after).map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a static list
          <div key={i} className={`tf-ai-diff-${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : 'same'}`}>
            {l.kind === '…' ? '…' : `${l.kind} ${l.text}`}
          </div>
        ))}
      </pre>
    </details>
  );
}
