// Setup and unlock forms of the key vault (hosted mode). Real forms with a
// username and a password field, so the browser's password manager offers to
// save the password and fills it in next time. The API key field is a text
// field masked by CSS, so the password manager does not take it for the
// password.

import { MIN_VAULT_PASSWORD, WrongPasswordError } from '@tinyforge/editor-core';
import { type FormEvent, useState } from 'react';
import { vault } from '../vault.ts';

/** The "username" the password manager saves the vault password under. */
const VAULT_USER = 'TinyForge keys';

function Username() {
  return (
    <label>
      Saved as
      <input type="text" name="username" autoComplete="username" value={VAULT_USER} readOnly />
    </label>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    action()
      .catch((err: unknown) =>
        setError(
          err instanceof WrongPasswordError ? 'Wrong password.' : err instanceof Error ? err.message : String(err),
        ),
      )
      .finally(() => setBusy(false));
  };
  return { busy, error, setError, submit };
}

export function VaultSetup() {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [key, setKey] = useState('');
  const { busy, error, setError, submit } = useSubmit(async () => {
    if (password !== again) throw new Error('The two passwords differ.');
    if (!key.trim().startsWith('sk-ant-')) throw new Error('An Anthropic API key starts with sk-ant-.');
    await vault.create(password, { anthropic: key.trim() });
  });
  return (
    <form className="tf-vault" data-testid="vault-setup" onSubmit={submit} onChange={() => setError('')}>
      <p>
        This copy of the editor has no server, so the AI uses your own Anthropic API key. It is kept on this device,
        encrypted with a password you choose, and unlocked each time you open the editor.
      </p>
      <ul className="tf-vault-advice">
        <li>Use a key made for this, with a monthly spending limit.</li>
        <li>Only on your own devices. On a shared one, use Forget keys afterwards.</li>
      </ul>
      <Username />
      <label>
        Password ({MIN_VAULT_PASSWORD}+ characters)
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          data-testid="vault-password"
          minLength={MIN_VAULT_PASSWORD}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Password again
        <input
          type="password"
          autoComplete="new-password"
          data-testid="vault-password-again"
          required
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      <label>
        Anthropic API key
        <input
          type="text"
          className="tf-vault-secret"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-testid="vault-anthropic-key"
          required
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      {error ? (
        <div className="tf-ai-error" role="alert" data-testid="vault-error">
          {error}
        </div>
      ) : null}
      <button type="submit" data-testid="vault-save" disabled={busy}>
        {busy ? 'Encrypting…' : 'Save and unlock'}
      </button>
    </form>
  );
}

export function VaultUnlock() {
  const [password, setPassword] = useState('');
  const [forgetting, setForgetting] = useState(false);
  const { busy, error, setError, submit } = useSubmit(() => vault.unlock(password));
  return (
    <form className="tf-vault" data-testid="vault-unlock" onSubmit={submit} onChange={() => setError('')}>
      <p>Unlock your API key to use the AI.</p>
      <Username />
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          data-testid="vault-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? (
        <div className="tf-ai-error" role="alert" data-testid="vault-error">
          {error}
        </div>
      ) : null}
      <button type="submit" data-testid="vault-unlock-button" disabled={busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <ForgetKeys forgetting={forgetting} setForgetting={setForgetting} />
    </form>
  );
}

/** Forget keys, with a second tap to confirm. */
export function ForgetKeys({
  forgetting,
  setForgetting,
}: {
  forgetting: boolean;
  setForgetting: (v: boolean) => void;
}) {
  if (!forgetting) {
    return (
      <button type="button" data-testid="vault-forget" onClick={() => setForgetting(true)}>
        Forget keys
      </button>
    );
  }
  return (
    <span className="tf-vault-confirm">
      Delete the keys from this device?
      <button type="button" data-testid="vault-forget-yes" onClick={() => void vault.forget()}>
        Delete
      </button>
      <button type="button" onClick={() => setForgetting(false)}>
        Keep
      </button>
    </span>
  );
}
