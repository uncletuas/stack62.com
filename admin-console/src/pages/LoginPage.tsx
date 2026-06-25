import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { AuthenticatedStaff, PlatformRole } from '../lib/types';

type LoginResponse =
  | { status: 'totp_required'; challengeToken: string }
  | { status: 'setup_required'; challengeToken: string };

interface SanitizedStaff {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
}

interface SessionResponse {
  accessToken: string;
  staff: SanitizedStaff;
}

type Stage = 'credentials' | 'setup' | 'verify';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password },
      });
      setChallengeToken(res.challengeToken);
      if (res.status === 'setup_required') {
        const setup = await api<{ secret: string; otpauthUri: string }>(
          '/auth/setup-2fa',
          {
            method: 'POST',
            auth: false,
            body: { challengeToken: res.challengeToken },
          },
        );
        setSecret(setup.secret);
        setOtpauthUri(setup.otpauthUri);
        setStage('setup');
      } else {
        setStage('verify');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<SessionResponse>('/auth/verify-2fa', {
        method: 'POST',
        auth: false,
        body: { challengeToken, code },
      });
      const staff: AuthenticatedStaff = {
        staffId: res.staff.id,
        email: res.staff.email,
        firstName: res.staff.firstName,
        lastName: res.staff.lastName,
        role: res.staff.role,
      };
      signIn(res.accessToken, staff);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-8">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-white">
            Stack62 Assembly
          </div>
          <div className="text-xs text-slate-500">
            Operations Console · staff only
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {stage === 'credentials' && (
          <form onSubmit={submitCredentials} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                autoComplete="username"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                autoComplete="current-password"
              />
            </Field>
            <button disabled={busy} className={buttonClass}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {stage === 'setup' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Set up two-factor authentication. Add this secret to your
              authenticator app (Google Authenticator, Authy, 1Password), then
              enter the 6-digit code to finish.
            </p>
            <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Manual entry secret
              </div>
              <div className="mt-1 break-all font-mono text-sm text-indigo-300">
                {secret}
              </div>
              <a
                href={otpauthUri}
                className="mt-2 inline-block text-xs text-slate-400 underline"
              >
                Open in authenticator app
              </a>
            </div>
            <CodeForm
              code={code}
              setCode={setCode}
              busy={busy}
              onSubmit={submitCode}
              label="Enable 2FA"
            />
          </div>
        )}

        {stage === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Enter the 6-digit code from your authenticator app.
            </p>
            <CodeForm
              code={code}
              setCode={setCode}
              busy={busy}
              onSubmit={submitCode}
              label="Verify"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CodeForm({
  code,
  setCode,
  busy,
  onSubmit,
  label,
}: {
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  label: string;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Authentication code">
        <input
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={`${inputClass} text-center tracking-[0.5em]`}
          autoComplete="one-time-code"
        />
      </Field>
      <button disabled={busy} className={buttonClass}>
        {busy ? 'Verifying…' : label}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500';
const buttonClass =
  'w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60';
