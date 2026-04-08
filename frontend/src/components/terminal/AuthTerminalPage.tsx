import { FormEvent, useState } from 'react';
import { loginUser, registerUser } from '../../lib/api';
import { AuthUser } from '../../types';

type Mode = 'login' | 'register';

interface AuthTerminalPageProps {
  onAuthenticated: (token: string, user: AuthUser) => void;
}

export function AuthTerminalPage({ onAuthenticated }: AuthTerminalPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response =
        mode === 'login'
          ? await loginUser({ email, password })
          : await registerUser({
              email,
              password,
              displayName: displayName || undefined,
            });

      onAuthenticated(response.token, response.user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto max-w-lg space-y-5">
      <header className="space-y-1 text-center">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Secure Access</p>
        <h1 className="text-3xl font-semibold text-white">{mode === 'login' ? 'Login To Your Desk' : 'Create Your Account'}</h1>
        <p className="text-sm text-zinc-400">
          Guests can use Calculator and Live Market. Portfolio, Chart Desk, and Journal need login.
        </p>
      </header>

      <form onSubmit={submit} className="terminal-card space-y-4 p-6">
        {mode === 'register' ? (
          <div className="space-y-1">
            <label htmlFor="displayName" className="text-xs uppercase tracking-wide text-zinc-400">
              Name
            </label>
            <input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="terminal-input"
              placeholder="Ujjwal"
            />
          </div>
        ) : null}

        <div className="space-y-1">
          <label htmlFor="email" className="text-xs uppercase tracking-wide text-zinc-400">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="terminal-input"
            placeholder="name@example.com"
            required
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-xs uppercase tracking-wide text-zinc-400">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="terminal-input"
            placeholder="At least 8 characters"
            required
          />
        </div>

        <button type="submit" disabled={loading} className="terminal-btn-primary w-full py-2.5">
          {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
        </button>

        {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}

        <div className="border-t border-zinc-800 pt-4 text-center text-sm text-zinc-400">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode((previous) => (previous === 'login' ? 'register' : 'login'));
              setError('');
            }}
            className="font-medium text-amber-300 hover:text-amber-200"
          >
            {mode === 'login' ? 'Register' : 'Login'}
          </button>
        </div>
      </form>
    </section>
  );
}
