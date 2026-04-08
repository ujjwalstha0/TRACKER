import { FormEvent, useState } from 'react';
import {
  loginUser,
  requestForgotPasswordOtp,
  requestRegisterOtp,
  resetForgotPassword,
  verifyRegisterOtp,
} from '../../lib/api';
import { AuthUser } from '../../types';

type Mode = 'login' | 'register' | 'forgot';

interface AuthTerminalPageProps {
  onAuthenticated: (token: string, user: AuthUser) => void;
}

export function AuthTerminalPage({ onAuthenticated }: AuthTerminalPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [registerOtpSent, setRegisterOtpSent] = useState(false);
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setError('');
    setInfo('');
    setOtp('');

    if (nextMode !== 'register') {
      setRegisterOtpSent(false);
      setDisplayName('');
    }

    if (nextMode !== 'forgot') {
      setForgotOtpSent(false);
      setNewPassword('');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');

    try {
      if (mode === 'login') {
        const response = await loginUser({ email, password });
        onAuthenticated(response.token, response.user);
        return;
      }

      if (mode === 'register') {
        if (!registerOtpSent) {
          await requestRegisterOtp({
            email,
            password,
            displayName: displayName || undefined,
          });
          setRegisterOtpSent(true);
          setInfo('OTP sent to your email. Enter it below to finish account creation.');
        } else {
          const response = await verifyRegisterOtp({
            email,
            otp,
          });
          onAuthenticated(response.token, response.user);
        }

        return;
      }

      if (!forgotOtpSent) {
        const response = await requestForgotPasswordOtp({ email });
        setForgotOtpSent(true);
        setInfo(response.message);
      } else {
        const response = await resetForgotPassword({
          email,
          otp,
          newPassword,
        });

        setInfo(response.message);
        setForgotOtpSent(false);
        setOtp('');
        setNewPassword('');
        setPassword('');
        setMode('login');
      }
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
        <h1 className="text-3xl font-semibold text-white">
          {mode === 'login'
            ? 'Login To Your Desk'
            : mode === 'register'
              ? registerOtpSent
                ? 'Verify OTP To Create Account'
                : 'Create Your Account'
              : forgotOtpSent
                ? 'Enter OTP And New Password'
                : 'Reset Your Password'}
        </h1>
        <p className="text-sm text-zinc-400">
          Guests can use Calculator and Live Market. Portfolio, Chart Desk, and Journal need login.
        </p>
      </header>

      <form onSubmit={submit} className="terminal-card space-y-4 p-6">
        {mode === 'register' && !registerOtpSent ? (
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

        {mode === 'login' || (mode === 'register' && !registerOtpSent) ? (
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
        ) : null}

        {(mode === 'register' && registerOtpSent) || (mode === 'forgot' && forgotOtpSent) ? (
          <div className="space-y-1">
            <label htmlFor="otp" className="text-xs uppercase tracking-wide text-zinc-400">
              OTP Code
            </label>
            <input
              id="otp"
              type="text"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="terminal-input font-mono tracking-[0.35em]"
              placeholder="123456"
              minLength={6}
              maxLength={6}
              required
            />
          </div>
        ) : null}

        {mode === 'forgot' && forgotOtpSent ? (
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
              placeholder="At least 8 characters"
              required
            />
          </div>
        ) : null}

        <button type="submit" disabled={loading} className="terminal-btn-primary w-full py-2.5">
          {loading
            ? 'Please wait...'
            : mode === 'login'
              ? 'Login'
              : mode === 'register'
                ? registerOtpSent
                  ? 'Verify OTP & Create Account'
                  : 'Send Registration OTP'
                : forgotOtpSent
                  ? 'Reset Password'
                  : 'Send Password Reset OTP'}
        </button>

        {info ? <p className="text-sm font-medium text-terminal-green">{info}</p> : null}
        {error ? <p className="text-sm font-medium text-terminal-red">{error}</p> : null}

        <div className="border-t border-zinc-800 pt-4 text-center text-sm text-zinc-400">
          {mode === 'login' ? (
            <>
              <span>Don&apos;t have an account? </span>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className="font-medium text-amber-300 hover:text-amber-200"
              >
                Register
              </button>
              <span className="mx-2 text-zinc-600">|</span>
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="font-medium text-amber-300 hover:text-amber-200"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <>
              <span>Already have an account? </span>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-medium text-amber-300 hover:text-amber-200"
              >
                Login
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
