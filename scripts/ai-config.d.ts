// Types for ai-config.js (imported by the proxy's tests).
export const PASSWORD_ITERATIONS: number;
export function aiConfigPhp(options: {
  anthropicKey: string;
  password: string;
  iterations?: number;
  extra?: Record<string, string | boolean>;
}): string;
