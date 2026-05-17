import { useState } from 'react';
import type { FormEvent } from 'react';
import { Building2, Layers } from 'lucide-react';
import { useAppContext } from '../context/app-context';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

export function OnboardingScreen() {
  const {
    currentOrganization,
    createOrganization,
    createWorkspace,
    needsOrganization,
    needsWorkspace,
    user,
  } = useAppContext();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOrganizationStep = needsOrganization;
  const step = isOrganizationStep ? 1 : 2;
  const totalSteps = 2;

  const domainHint = (() => {
    const email = user?.email ?? '';
    const domain = email.split('@')[1] ?? '';
    if (!domain || domain.includes('gmail') || domain.includes('yahoo') || domain.includes('hotmail')) return '';
    const company = domain.split('.')[0] ?? '';
    return company.charAt(0).toUpperCase() + company.slice(1);
  })();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (isOrganizationStep) {
        await createOrganization({ name, description });
      } else {
        await createWorkspace({ name, description });
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('stack62:open-coworker'));
        }, 800);
      }
      setName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-6">
      <div className="w-full max-w-lg">
        {/* Logo / brand */}
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-app">Stack62</p>
          <p className="mt-1 text-sm text-app-muted">Your AI-powered business operations platform</p>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="mb-1.5 flex items-center justify-between text-xs text-app-faint">
            <span>Step {step} of {totalSteps}</span>
            <span>{step === 1 ? 'Organization' : 'Workspace'}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-hover">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-app bg-app-surface p-8 shadow-lg">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
              {isOrganizationStep ? <Building2 className="h-5 w-5" /> : <Layers className="h-5 w-5" />}
            </span>
            <div>
              <h1 className="text-lg font-semibold text-app">
                {isOrganizationStep ? 'Create your organization' : 'Create your first workspace'}
              </h1>
              <p className="text-sm text-app-muted">
                {isOrganizationStep
                  ? `Welcome${user?.firstName ? `, ${user.firstName}` : ''}. This is your company's home in Stack62.`
                  : `A workspace groups your systems and coworker for ${currentOrganization?.name || 'your organization'}.`}
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="onboarding-name">
                {isOrganizationStep ? 'Organization name' : 'Workspace name'}
              </Label>
              <Input
                id="onboarding-name"
                placeholder={
                  isOrganizationStep
                    ? domainHint || 'Acme Corp'
                    : 'Operations'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="text-app"
              />
              {isOrganizationStep && domainHint && !name && (
                <button
                  type="button"
                  onClick={() => setName(domainHint)}
                  className="text-[11px] text-accent hover:underline"
                >
                  Use "{domainHint}"
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onboarding-description">
                {isOrganizationStep ? 'What does your company do?' : 'What will this workspace be used for?'}
                <span className="ml-1 text-app-faint">(optional)</span>
              </Label>
              <Textarea
                id="onboarding-description"
                placeholder={
                  isOrganizationStep
                    ? 'e.g. We help logistics companies automate their operations.'
                    : 'e.g. Day-to-day operations, approvals, and reporting.'
                }
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {error && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-400">{error}</p>}

            <Button className="w-full" disabled={submitting || !name.trim()} size="lg">
              {submitting
                ? 'Setting up…'
                : isOrganizationStep
                  ? 'Continue →'
                  : 'Launch my workspace'}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-app-faint">
          {isOrganizationStep
            ? 'You can rename or add more organizations later in Settings.'
            : 'Your AI coworker will be ready immediately after setup.'}
        </p>
      </div>
    </div>
  );
}
