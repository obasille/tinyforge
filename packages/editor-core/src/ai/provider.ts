// The AI provider interface: one chat with tools, whatever the service. Each
// adapter (anthropic.ts, ...) keeps the conversation in its own format, so
// nothing a service needs to see again (thinking blocks, say) is lost.

/** A tool the model can call. `schema` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** A part of the system prompt. `cache` marks the end of a part that never changes, so it can be cached. */
export interface SystemPart {
  text: string;
  cache?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

/** What the user sends: the results of the tools the model called, a message, or both. */
export interface ChatInput {
  results?: ToolResult[];
  text?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One reply of the model. */
export interface ChatTurn {
  text: string;
  calls: ToolCall[];
  /** Why it stopped: done, wants tools, ran out of tokens, or declined. */
  stop: 'end' | 'tools' | 'max_tokens' | 'refusal';
  usage: Usage;
  /** Estimated cost in US dollars, or null when the price is unknown. */
  cost: number | null;
}

export interface SendOptions {
  signal?: AbortSignal;
  /** Text as it arrives. */
  onText?: (delta: string) => void;
  /** The model's thinking (a summary, for Claude) as it arrives, when the service sends it. */
  onThinking?: (delta: string) => void;
}

export interface Chat {
  send(input: ChatInput, options?: SendOptions): Promise<ChatTurn>;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatSettings {
  model: string;
  effort: Effort;
}

export interface ChatOptions {
  /** Read on every send, so a change of model or effort applies to the next reply. */
  settings: () => ChatSettings;
  system: SystemPart[];
  tools: ToolSpec[];
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  /** Models this provider offers (the dev server accepts only these). */
  readonly models: string[];
  /** Whether the provider has an effort setting. */
  readonly hasEffort: boolean;
  createChat(options: ChatOptions): Chat;
}

/** What the dev server reports at /__tf/ai/status. */
export interface AiStatus {
  /** The providers with a key (or an address) in .env. */
  providers: Array<{ id: string; models: string[]; defaultModel: string }>;
  /** Why AI is off when no provider is listed, or a setting in .env that is refused. */
  reason?: string;
  /** The deployed editor's proxy wants a login first (how). */
  login?: 'password';
  /** Logged in to the deployed editor's proxy: the panel offers Log out. */
  session?: boolean;
  /** The proxy saves to this repository's branch (the editor then runs on it). */
  github?: { repo: string; branch: string };
}

/** Log in to the deployed editor's AI proxy. Resolves to an error message, or null when logged in. */
export async function aiLogin(password: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(`${AI_BASE}/login`, {
    method: 'POST',
    headers: { 'X-TinyForge': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return null;
  return res.status === 401 ? 'Wrong password.' : (await res.text()).slice(0, 200) || `Error ${res.status}`;
}

/** Log out of the deployed editor's AI proxy. */
export async function aiLogout(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn(`${AI_BASE}/logout`, { method: 'POST', headers: { 'X-TinyForge': '1' } });
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Where the dev server's AI routes live. */
export const AI_BASE = '/__tf/ai';

/** Ask the dev server which providers are set up. Null when there is no dev server (a static build). */
export async function fetchAiStatus(fetchFn: typeof fetch = fetch): Promise<AiStatus | null> {
  try {
    const res = await fetchFn(`${AI_BASE}/status`, { headers: { 'X-TinyForge': '1' } });
    if (res.ok) return (await res.json()) as AiStatus;
    // Refused by the dev server (opened from another address, say): show its reason.
    if (res.status === 403) return { providers: [], reason: (await res.text()).slice(0, 200) };
    return null;
  } catch {
    return null;
  }
}
