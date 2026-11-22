import { describe, expect, it } from 'vitest';
import { OpenAiProvider } from '../src/ai/openai.ts';

/** A streamed Chat Completions reply, cut into chunks that split lines. */
function sse(events: unknown[]): Response {
  const text = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;
  const chunks = text.match(/[\s\S]{1,17}/g) ?? [];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('OpenAI-compatible adapter', () => {
  it('streams text and tool calls, and sends the history back in its format', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const replies = [
      sse([
        { choices: [{ delta: { content: 'Let me ' } }] },
        { choices: [{ delta: { content: 'look.' } }] },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"pa' } }] } },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        {
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 40 } },
        },
      ]),
      sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }]),
      new Response('model not found', { status: 404 }),
    ];
    const fetchFn = (async (url: string, init: RequestInit) => {
      expect(url).toBe('http://localhost:5173/__tf/ai/openai/v1/chat/completions');
      expect((init.headers as Record<string, string>)['X-TinyForge']).toBe('1');
      bodies.push(JSON.parse(String(init.body)));
      return replies.shift();
    }) as unknown as typeof fetch;
    const provider = new OpenAiProvider('http://localhost:5173', ['qwen3:8b'], fetchFn);
    const chat = provider.createChat({
      settings: () => ({ model: 'qwen3:8b', effort: 'medium' }),
      system: [{ text: 'rules', cache: true }],
      tools: [{ name: 'read_file', description: 'Read', schema: { properties: {}, required: [] } }],
    });
    const streamed: string[] = [];
    const first = await chat.send({ text: 'hi' }, { onText: (d) => streamed.push(d) });
    expect(streamed.join('')).toBe('Let me look.');
    expect(first).toMatchObject({
      text: 'Let me look.',
      stop: 'tools',
      calls: [{ id: 'c1', name: 'read_file', input: { path: 'a.ts' } }],
      usage: { input: 60, cacheRead: 40, output: 7 },
      cost: null,
    });
    expect(bodies[0]).toMatchObject({
      model: 'qwen3:8b',
      stream: true,
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hi' },
      ],
      tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
    });
    const second = await chat.send({ results: [{ id: 'c1', content: 'not found', isError: true }] });
    expect(second).toMatchObject({ text: 'Done.', stop: 'end', calls: [] });
    expect((bodies[1].messages as unknown[]).slice(2)).toEqual([
      {
        role: 'assistant',
        content: 'Let me look.',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'Error: not found' },
    ]);
    // A failed request leaves the history as it was.
    await expect(chat.send({ text: 'again' })).rejects.toThrow('404 model not found');
    replies.push(sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'length' }] }]));
    expect((await chat.send({ text: 'again' })).stop).toBe('max_tokens');
    expect((bodies[3].messages as unknown[]).length).toBe(6);
  });
});
