// The models the editor offers. The dev server's proxy imports this list too
// and refuses any other model. No imports, so Node loads it cheaply.

export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
