import { expect, type Page, test } from '@playwright/test';

// Hosted mode: the static build has no dev server, so the AI panel keeps the
// user's key in the encrypted key vault and calls api.anthropic.com itself
// (faked here; the request still goes through the site's CSP).

const PASSWORD = 'a long test password';
const KEY = 'sk-ant-api03-e2e-0123456789abcdefghijklmnop';

/** A streamed Messages API reply with one text block. */
function reply(text: string): string {
  const ev = (type: string, data: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return (
    ev('message_start', {
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }) +
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }) +
    ev('content_block_stop', { index: 0 }) +
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
    ev('message_stop', {})
  );
}

async function fakeApi(page: Page) {
  const requests: Array<Record<string, string>> = [];
  await page.route('https://api.anthropic.com/**', (route) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    requests.push(route.request().headers());
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: reply('Hello from Claude.'),
    });
  });
  return requests;
}

async function openAi(page: Page) {
  await page.getByTestId('app-menu').click();
  await page.getByTestId('show-ai').click();
  return page.getByTestId('ai-panel');
}

/** Everything the vault database holds, as text. */
const storedVault = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('tinyforge-vault');
        req.onsuccess = () => {
          const get = req.result.transaction('vault').objectStore('vault').get('keys');
          get.onsuccess = () =>
            resolve(JSON.stringify(get.result, (_k, v) => (v instanceof Uint8Array ? String.fromCharCode(...v) : v)));
        };
      }),
  );

test('the key vault unlocks the AI, which calls Anthropic directly with the key', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && errors.push(m.text()));
  const requests = await fakeApi(page);
  await page.goto('/');
  let panel = await openAi(page);

  // First time: set up the vault.
  await panel.getByTestId('vault-password').fill(PASSWORD);
  await panel.getByTestId('vault-password-again').fill(PASSWORD);
  await panel.getByTestId('vault-anthropic-key').fill(KEY);
  await panel.getByTestId('vault-save').click();
  await expect(panel.getByTestId('ai-model')).toHaveValue('anthropic:claude-opus-5-5');

  // Storage holds only ciphertext.
  const stored = await storedVault(page);
  expect(stored).toContain('"iterations":600000');
  expect(stored).not.toContain('sk-ant');
  expect(stored).not.toContain(PASSWORD);

  await panel.getByTestId('ai-input').fill('Say hello');
  await panel.getByTestId('ai-input').press('Enter');
  await expect(panel.getByTestId('ai-items')).toContainText('Hello from Claude.');
  expect(requests).toHaveLength(1);
  expect(requests[0]['x-api-key']).toBe(KEY);
  expect(requests[0]['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(requests[0]['x-tinyforge']).toBeUndefined();

  // Lock: the conversation stays, the key goes.
  await panel.getByTestId('vault-lock').click();
  await expect(panel.getByTestId('vault-unlock')).toBeVisible();
  await panel.getByTestId('vault-password').fill('not the password');
  await panel.getByTestId('vault-unlock-button').click();
  await expect(panel.getByTestId('vault-error')).toHaveText('Wrong password.');
  await panel.getByTestId('vault-password').fill(PASSWORD);
  await panel.getByTestId('vault-unlock-button').click();
  await expect(panel.getByTestId('ai-items')).toContainText('Hello from Claude.');

  // A reload starts locked.
  await page.reload();
  panel = await openAi(page);
  await expect(panel.getByTestId('vault-unlock')).toBeVisible();

  // Forget keys: back to setup, nothing stored.
  await panel.getByTestId('vault-forget').click();
  await panel.getByTestId('vault-forget-yes').click();
  await expect(panel.getByTestId('vault-setup')).toBeVisible();
  expect(await storedVault(page)).toBe(undefined);
  expect(errors).toEqual([]);
});
