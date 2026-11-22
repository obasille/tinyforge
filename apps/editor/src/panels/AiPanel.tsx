// The AI panel: a chat with the code agent (editor-core/src/ai) about the
// current game, and the AI settings. Loaded only when the panel opens, so
// the rest of the editor does not carry the AI code.
//
// The settings (model, effort, show cost) are a preference of this browser,
// saved in localStorage; the dev server's .env sets the default model. The
// API key never reaches the page.

import { createStore } from '@tinyforge/editor-core';
import {
  Agent,
  type AiStatus,
  type ChatItem,
  type ChatSettings,
  ClaudeProvider,
  type Effort,
  type FileChangeView,
  fetchAiStatus,
  lineDiff,
  readSdkApi,
  systemPrompt,
} from '@tinyforge/editor-core/ai';
import { useEffect, useRef, useState } from 'react';
import guide from '../../../../AGENTS.md?raw';
import { useEditor } from '../EditorContext.ts';
import type { Editor } from '../editor.ts';
import { useStore } from '../hooks.ts';

const SETTINGS_KEY = 'tinyforge.editor.ai';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface AiSettings extends ChatSettings {
  showCost: boolean;
}

function loadSettings(): Partial<AiSettings> {
  try {
    return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<AiSettings> | null) ?? {};
  } catch {
    return {};
  }
}

/** Saved settings; the model is filled in from the dev server's default once known. */
const settings = createStore<AiSettings>({ model: '', effort: 'medium', showCost: true, ...loadSettings() });
settings.subscribe(() => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.getState()));
  } catch {
    // Storage may be unavailable; the settings still apply for this session.
  }
});

/** One conversation per game, kept while the page is open. */
const agents = new Map<string, Agent>();
let system: Promise<ReturnType<typeof systemPrompt>> | null = null;

async function agentFor(editor: Editor, game: string): Promise<Agent> {
  const existing = agents.get(game);
  if (existing) return existing;
  system ??= readSdkApi(editor.files).then((sdk) => systemPrompt(guide, sdk));
  const agent = new Agent({
    provider: new ClaudeProvider(location.origin),
    settings: () => settings.getState(),
    system: await system,
    commands: editor.commands,
    buildStatus: () => editor.compiler.builds.getState()[game]?.status ?? 'not built',
    context: {
      files: editor.files,
      game,
      build: () => editor.compiler.build(game),
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
  agents.set(game, agent);
  return agent;
}

export default function AiPanel() {
  const editor = useEditor();
  const game = useStore(editor.project).game;
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [agent, setAgent] = useState<Agent | null>(null);

  useEffect(() => {
    void fetchAiStatus().then((s) => {
      setStatus(s);
      const provider = s?.providers[0];
      if (provider && !provider.models.includes(settings.getState().model)) {
        settings.setState((x) => ({ ...x, model: provider.defaultModel }));
      }
    });
  }, []);

  useEffect(() => {
    setAgent(null);
    if (!game || !status?.providers.length) return;
    let live = true;
    void agentFor(editor, game).then((a) => live && setAgent(a));
    return () => {
      live = false;
    };
  }, [editor, game, status]);

  const newChat = () => {
    if (!game || agent?.state.getState().running) return;
    agents.delete(game);
    void agentFor(editor, game).then(setAgent);
  };

  let notice: string | null = null;
  if (status === null) notice = 'AI needs the dev server (pnpm dev). A static build has no AI.';
  else if (status && status.providers.length === 0) notice = status.reason ?? 'AI is not set up.';
  else if (!game) notice = 'Pick a game first.';

  return (
    <div className="tf-ai" data-testid="ai-panel">
      <Settings status={status ?? null} onNewChat={newChat} />
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

function Settings({ status, onNewChat }: { status: AiStatus | null; onNewChat: () => void }) {
  const s = useStore(settings);
  const models = status?.providers.flatMap((p) => p.models) ?? [];
  return (
    <div className="tf-ai-settings">
      <label>
        Model
        <select
          data-testid="ai-model"
          value={s.model}
          disabled={models.length === 0}
          onChange={(e) => settings.setState((x) => ({ ...x, model: e.target.value }))}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label title="More effort thinks longer: better on hard requests, slower and costlier">
        Effort
        <select
          data-testid="ai-effort"
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
          <Item key={i} item={item} showCost={showCost} />
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

function Item({ item, showCost }: { item: ChatItem; showCost: boolean }) {
  switch (item.kind) {
    case 'user':
      return <div className="tf-ai-user">{item.text}</div>;
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
  return (
    <details className="tf-ai-file">
      <summary>
        {`${file.path} (${verb})`}
        {file.after !== null ? (
          <button type="button" onClick={() => editor.workbench.openFile(file.path)}>
            Open
          </button>
        ) : null}
      </summary>
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
