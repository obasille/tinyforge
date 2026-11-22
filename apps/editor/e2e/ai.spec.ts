// The AI panel against the real dev server, with the model replaced by
// scripted replies: the page's requests to the AI routes are answered here,
// so no key is needed and nothing reaches the Anthropic API.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GAMES = path.join(REPO, 'packages', 'engine', 'assembly', 'games');
const ASSETS = path.join(REPO, 'assets');

let game = '';

test.beforeEach(async ({ page }) => {
  game = `e2e${Date.now().toString(36)}`;
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('tf-test-init')) {
      localStorage.clear();
      sessionStorage.setItem('tf-test-init', '1');
    }
  });
});

test.afterEach(() => {
  rmSync(path.join(GAMES, game), { recursive: true, force: true });
  for (const file of [`sprites/${game}.png`, `sfx/${game}.wav`]) {
    rmSync(path.join(ASSETS, file), { force: true });
    rmSync(path.join(ASSETS, `${file}.json`), { force: true });
  }
});

type Block = { text: string } | { tool: string; input: Record<string, unknown> };

/** A streamed Messages API reply (server-sent events) with these blocks. */
function reply(blocks: Block[]): string {
  const ev = (type: string, data: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', {
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
  blocks.forEach((b, index) => {
    if ('text' in b) {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      const id = `toolu_${index}_${Math.random().toString(36).slice(2)}`;
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id, name: b.tool, input: {} } });
      out += ev('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
      });
    }
    out += ev('content_block_stop', { index });
  });
  const stop = blocks.some((b) => 'tool' in b) ? 'tool_use' : 'end_turn';
  out += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } });
  out += ev('message_stop', {});
  return out;
}

/** Answer the AI routes: AI is set up, and the model says `replies` in order. */
async function fakeModel(page: Page, replies: Block[][]) {
  const requests: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
  await page.route('**/__tf/ai/status', (route) =>
    route.fulfill({
      json: {
        providers: [
          { id: 'anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5'], defaultModel: 'claude-opus-5-5' },
        ],
      },
    }),
  );
  await page.route('**/__tf/ai/anthropic/v1/messages', (route) => {
    requests.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
    const next = replies.shift();
    if (!next) return route.fulfill({ status: 500, body: 'no more replies' });
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply(next) });
  });
  return requests;
}

async function createGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByTestId('files-name').fill(game);
  await page.getByTestId('files-name').press('Enter');
  await expect.poll(() => page.evaluate((g) => window.__tf?.editor.games.includes(g), game)).toBe(true);
  await page.evaluate((g) => window.__tf?.editor.selectGame(g), game);
  await expect(page.getByTestId('game-select')).toHaveAttribute('data-game', game);
}

const mainFile = () => path.join(GAMES, game, 'main.ts');

test('the code agent edits the game, compiles, and one undo reverts the request', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = await fakeModel(page, [
    [
      { text: 'I will change the description.' },
      {
        tool: 'edit_file',
        input: {
          path: `games/${game}/main.ts`,
          old: 'const DESCRIPTION = "A new game";',
          new: 'const DESCRIPTION = "Made by AI";',
        },
      },
    ],
    [{ tool: 'compile', input: {} }],
    [{ text: 'Done: the description now says Made by AI.' }],
  ]);
  await page.goto('/');
  await createGame(page);
  const original = readFileSync(mainFile(), 'utf8');

  await page.getByTestId('show-ai').click();
  const panel = page.getByTestId('ai-panel');
  await expect(panel.getByTestId('ai-model')).toHaveValue('anthropic:claude-opus-5-5');
  await panel.getByTestId('ai-input').fill('Change the description');
  await panel.getByTestId('ai-input').press('Enter');

  await expect(panel.getByTestId('ai-items')).toContainText('Done: the description now says Made by AI.');
  await expect(panel.getByTestId('ai-items')).toContainText(`✓ Edited games/${game}/main.ts`);
  await expect(panel.getByTestId('ai-items')).toContainText('✓ Compiled: ok');
  await expect(panel.getByTestId('ai-changes')).toContainText(`games/${game}/main.ts (changed)`);
  expect(readFileSync(mainFile(), 'utf8')).toContain('"Made by AI"');

  // What reached the "API": the key is not in the page, the prompt is cached, the game is in the request.
  expect(requests).toHaveLength(3);
  const first = requests[0];
  expect(first.headers['x-tinyforge']).toBe('1');
  expect(JSON.stringify(first.headers)).not.toContain('sk-ant');
  expect(first.body.model).toBe('claude-opus-5-5');
  const system = first.body.system as Array<{ text: string; cache_control?: unknown }>;
  expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(system[0].text).toContain('TinyForge guide (AGENTS.md)');
  expect(system[0].text).toContain('export function buttonDown(');
  expect(JSON.stringify(first.body.messages)).toContain(`Current game: ${game}`);
  expect((first.body.tools as unknown[]).length).toBe(10);

  // One undo step for the whole request.
  await expect(page.getByRole('button', { name: 'Undo AI: Change the description' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo AI: Change the description' }).click();
  await expect.poll(() => readFileSync(mainFile(), 'utf8')).toBe(original);
  expect(errors).toEqual([]);
});

test('without a key the panel says how to set it up', async ({ page }) => {
  await page.route('**/__tf/ai/status', (route) =>
    route.fulfill({ json: { providers: [], reason: 'Add ANTHROPIC_API_KEY to .env and restart the dev server.' } }),
  );
  await page.goto('/');
  await page.getByTestId('show-ai').click();
  await expect(page.getByTestId('ai-notice')).toContainText('ANTHROPIC_API_KEY');
  // The real route answers the editor, and refuses requests without the editor's header.
  const ok = await page.request.get('/__tf/ai/status', { headers: { 'X-TinyForge': '1' } });
  expect(ok.status()).toBe(200);
  expect(await ok.text()).not.toContain('sk-ant');
  expect((await page.request.get('/__tf/ai/status')).status()).toBe(403);
});

test('the agent makes a sprite and a sound the game can use, and undo removes them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeModel(page, [
    [
      {
        tool: 'make_sprite',
        input: { id: game, palette: { r: '#ff0000' }, frames: [['.r.', 'rrr', '.r.']] },
      },
      { tool: 'make_sound', input: { id: game, kind: 'sfx', notes: [{ at: 0, len: 0.1, note: 'C5', to: 'C6' }] } },
    ],
    [
      {
        tool: 'edit_file',
        input: { path: `games/${game}/main.ts`, old: 'import { Button,', new: 'import { playSfx, s, Button,' },
      },
      {
        tool: 'edit_file',
        input: {
          path: `games/${game}/main.ts`,
          old: 'export function init(): void {',
          new: `export function init(): void {\n  playSfx("${game}", 1.0);\n  s("${game}");`,
        },
      },
    ],
    [{ tool: 'compile', input: {} }],
    [{ text: 'Added a sprite and a sound.' }],
  ]);
  await page.goto('/');
  await createGame(page);
  await page.getByTestId('show-ai').click();
  const panel = page.getByTestId('ai-panel');
  await panel.getByTestId('ai-input').fill('Add a sprite and a sound');
  await panel.getByTestId('ai-input').press('Enter');

  await expect(panel.getByTestId('ai-items')).toContainText('Added a sprite and a sound.');
  await expect(panel.getByTestId('ai-items')).toContainText(`✓ Made sprite ${game}`);
  await expect(panel.getByTestId('ai-items')).toContainText(`✓ Made sound ${game}`);
  // The compile found the new IDs.
  await expect(panel.getByTestId('ai-items')).toContainText('✓ Compiled: ok');
  expect(existsSync(path.join(ASSETS, 'sprites', `${game}.png`))).toBe(true);
  const sidecar = JSON.parse(readFileSync(path.join(ASSETS, 'sfx', `${game}.wav.json`), 'utf8'));
  expect(sidecar.generator).toBe('tinyforge-ai');
  expect(sidecar.prompt).toBe('Add a sprite and a sound');

  await page.getByRole('button', { name: 'Undo AI: Add a sprite and a sound' }).click();
  await expect.poll(() => existsSync(path.join(ASSETS, 'sprites', `${game}.png`))).toBe(false);
  expect(existsSync(path.join(ASSETS, 'sfx', `${game}.wav.json`))).toBe(false);
  expect(errors).toEqual([]);
});

test('a model from the OpenAI-compatible server in .env works the same way', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const replies = [
    chunk({
      tool_calls: [
        {
          index: 0,
          id: 'call_1',
          type: 'function',
          function: {
            name: 'edit_file',
            arguments: JSON.stringify({
              path: `games/${game}/main.ts`,
              old: 'const DESCRIPTION = "A new game";',
              new: 'const DESCRIPTION = "Made locally";',
            }),
          },
        },
      ],
    }) + chunk({}, 'tool_calls'),
    `${chunk({ content: 'Changed it.' }, 'stop')}data: [DONE]\n\n`,
  ];
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/__tf/ai/status', (route) =>
    route.fulfill({
      json: {
        providers: [
          { id: 'anthropic', models: ['claude-opus-5-5'], defaultModel: 'claude-opus-5-5' },
          { id: 'openai', models: ['qwen3:8b'], defaultModel: 'qwen3:8b' },
        ],
      },
    }),
  );
  await page.route('**/__tf/ai/openai/v1/chat/completions', (route) => {
    bodies.push(route.request().postDataJSON());
    const next = replies.shift();
    return next
      ? route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: next })
      : route.fulfill({ status: 500, body: 'no more replies' });
  });
  await page.goto('/');
  await createGame(page);
  await page.getByTestId('show-ai').click();
  const panel = page.getByTestId('ai-panel');
  await panel.getByTestId('ai-model').selectOption('openai:qwen3:8b');
  await expect(panel.getByTestId('ai-effort')).toBeDisabled();
  await panel.getByTestId('ai-input').fill('Change the description');
  await panel.getByTestId('ai-input').press('Enter');

  await expect(panel.getByTestId('ai-items')).toContainText('Changed it.');
  await expect(panel.getByTestId('ai-items')).toContainText(`✓ Edited games/${game}/main.ts`);
  await expect(panel.getByText('This request: cost unknown')).toBeVisible();
  expect(readFileSync(mainFile(), 'utf8')).toContain('"Made locally"');
  expect(bodies[0].model).toBe('qwen3:8b');
  expect((bodies[0].messages as Array<{ role: string }>)[0].role).toBe('system');
  expect(errors).toEqual([]);
});
