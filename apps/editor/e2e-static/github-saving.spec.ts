import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

// The deployed editor saving to GitHub. The proxy's GitHub routes are faked
// here (their PHP is tested in vite/ai-proxy-php.test.ts): the mobile branch
// is the deployed copy, so files come from the static __tf/files/.

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

type Block = { text: string } | { tool: string; input: Record<string, unknown> };

function reply(blocks: Block[]): string {
  const ev = (type: string, data: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', {
    message: {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  });
  blocks.forEach((b, index) => {
    if ('text' in b) {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      out += ev('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: `toolu_${index}`, name: b.tool, input: {} },
      });
      out += ev('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
      });
    }
    out += ev('content_block_stop', { index });
  });
  const stop = blocks.some((b) => 'tool' in b) ? 'tool_use' : 'end_turn';
  out += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  return out + ev('message_stop', {});
}

async function fakeSite(page: Page, replies: Block[][]) {
  const { files } = JSON.parse(readFileSync(path.join(DIST, '__tf', 'files.json'), 'utf8')) as {
    files: Array<{ path: string; size: number; sha: string }>;
  };
  const commits: Array<{ base: string; message: string; changes: Array<{ path: string; content?: string }> }> = [];
  let head = 'a'.repeat(40);
  await page.route('**/__tf/ai/status', (route) =>
    route.fulfill({
      json: {
        providers: [{ id: 'anthropic', models: ['claude-opus-5-5'], defaultModel: 'claude-opus-5-5' }],
        session: true,
        github: { repo: 'me/game', branch: 'mobile' },
      },
    }),
  );
  await page.route('**/__tf/ai/github/tree', (route) =>
    route.fulfill({ json: { head, files: files.map(({ path: p, size, sha }) => ({ path: p, size, sha })) } }),
  );
  await page.route('**/__tf/ai/github/commit', (route) => {
    const body = route.request().postDataJSON();
    commits.push(body);
    if (body.base !== head) return route.fulfill({ status: 409, json: { head } });
    head = 'b'.repeat(40);
    return route.fulfill({ json: { head, blobs: { 'games/pong/main.ts': 'c'.repeat(40) } } });
  });
  await page.route('**/__tf/ai/anthropic/v1/messages', (route) => {
    const next = replies.shift();
    if (!next) return route.fulfill({ status: 500, body: 'no more replies' });
    return route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: reply(next) });
  });
  return commits;
}

test('an AI edit becomes one commit on the mobile branch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const commits = await fakeSite(page, [
    [
      {
        tool: 'edit_file',
        input: {
          path: 'games/pong/main.ts',
          old: 'const PADDLE_WIDTH: i32 = 40;',
          new: 'const PADDLE_WIDTH: i32 = 80;',
        },
      },
    ],
    [{ tool: 'compile', input: {} }],
    [{ text: 'The paddles are twice as wide.' }],
  ]);
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await expect(page.getByTestId('run-status')).toHaveText('running');

  await page.getByTestId('app-menu').click();
  await page.getByTestId('show-ai').click();
  const panel = page.getByTestId('ai-panel');
  await expect(panel.getByTestId('ai-read-only')).toHaveCount(0);
  await panel.getByTestId('ai-input').fill('Make the paddles twice as wide');
  await panel.getByTestId('ai-input').press('Enter');
  await expect(panel.getByTestId('ai-items')).toContainText('The paddles are twice as wide.');
  await expect(panel.getByTestId('ai-items')).toContainText('✓ Compiled: ok');

  // Saved a few seconds later, or now with Save.
  await expect(page.getByTestId('save-state')).toContainText('Unsaved');
  await page.getByTestId('save-now').click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  expect(commits).toHaveLength(1);
  expect(commits[0].base).toBe('a'.repeat(40));
  expect(commits[0].changes).toHaveLength(1);
  expect(commits[0].changes[0].path).toBe('games/pong/main.ts');
  expect(Buffer.from(commits[0].changes[0].content ?? '', 'base64').toString()).toContain(
    'const PADDLE_WIDTH: i32 = 80;',
  );
  expect(errors).toEqual([]);
});
