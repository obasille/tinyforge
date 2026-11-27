import { expect, type Page, test } from '@playwright/test';

// The deployed editor's AI: the PHP proxy (server/ai/index.php) is faked here
// with routes; its own tests are in vite/ai-proxy-php.test.ts. The page goes
// through the site's CSP as deployed.

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

async function fakeProxy(page: Page) {
  let loggedIn = false;
  const logins: string[] = [];
  const requests: Array<Record<string, string>> = [];
  await page.route('**/__tf/ai/status', (route) =>
    route.fulfill({
      json: loggedIn
        ? {
            providers: [{ id: 'anthropic', models: ['claude-opus-5-5'], defaultModel: 'claude-opus-5-5' }],
            session: true,
          }
        : { providers: [], login: 'password' },
    }),
  );
  await page.route('**/__tf/ai/login', (route) => {
    const { password } = route.request().postDataJSON() as { password: string };
    logins.push(password);
    loggedIn = password === 'the right password';
    return loggedIn ? route.fulfill({ json: { ok: true } }) : route.fulfill({ status: 401, body: 'Wrong password' });
  });
  await page.route('**/__tf/ai/logout', (route) => {
    loggedIn = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/__tf/ai/anthropic/v1/messages', (route) => {
    requests.push(route.request().headers());
    return route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: reply('Hello from Claude.') });
  });
  return { logins, requests };
}

test('the deployed editor logs in to its AI proxy, chats, and logs out', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const { logins, requests } = await fakeProxy(page);
  await page.goto('/');
  await page.getByTestId('app-menu').click();
  await page.getByTestId('show-ai').click();
  const panel = page.getByTestId('ai-panel');

  await panel.getByTestId('ai-login-password').fill('not it');
  await panel.getByTestId('ai-login-submit').click();
  await expect(panel.getByTestId('ai-login-error')).toHaveText('Wrong password.');
  await panel.getByTestId('ai-login-password').fill('the right password');
  await panel.getByTestId('ai-login-submit').click();
  await expect(panel.getByTestId('ai-model')).toHaveValue('anthropic:claude-opus-5-5');
  // The static copy cannot save: the panel says so (and the AI is told).
  await expect(panel.getByTestId('ai-read-only')).toBeVisible();
  expect(logins).toEqual(['not it', 'the right password']);

  await panel.getByTestId('ai-input').fill('Say hello');
  await panel.getByTestId('ai-input').press('Enter');
  await expect(panel.getByTestId('ai-items')).toContainText('Hello from Claude.');
  // Same as with the dev server: no key in the page, only the editor's header.
  expect(requests[0]['x-tinyforge']).toBe('1');
  expect(JSON.stringify(requests)).not.toContain('sk-ant');

  await panel.getByTestId('ai-logout').click();
  await expect(panel.getByTestId('ai-login')).toBeVisible();
  // The 401 of the wrong password is the only console error.
  expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
});
