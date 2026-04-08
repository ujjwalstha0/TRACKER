import { FormEvent, useState } from 'react';
import { changePassword } from '../../lib/api';
import { AuthUser } from '../../types';

interface AccountSecurityTerminalPageProps {
  user: AuthUser;
}

export function AccountSecurityTerminalPage({ user }: AccountSecurityTerminalPageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }

    setLoading(true);

    try {
      const response = await changePassword({
        currentPassword,
        newPassword,
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Account Security</p>
        <h1 className="text-2xl font-semibold text-white">Password Settings</h1>
      </header>

      <section className="terminal-card space-y-5 p-6">
        <div className="rounded-xl border border-zinc-800 bg-black/50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Email (locked)</p>
          <p className="mt-2 font-mono text-sm text-zinc-200">{user.email}</p>
          <p className="mt-2 text-xs text-zinc-500">Email changes are disabled for account safety. Only password can be changed.</p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <label htmlFor="currentPassword" className="text-xs uppercase tracking-wide text-zinc-400">
              Current Password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="terminal-input"
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="newPassword" className="text-xs uppercase tracking-wide text-zinc-400">
              New Password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="terminal-input"
              minLength={8}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="confirmPassword" className="text-xs uppercase tracking-wide text-zinc-400">
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="terminal-input"
              minLength={8}
              required
            />
          </div>

          <div className="md:col-span-2">
            <button type="submit" disabled={loading} className="terminal-btn-primary w-full py-2.5">
              {loading ? 'Updating...' : 'Change Password'}
            </button>
          </div>
        </form>

        {success ? <p className="text-sm font-medium text-terminal-green">{success}</p> : null}
        {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}
      </section>
    </section>
  );
}
