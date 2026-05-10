import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAppContext } from '../context/app-context';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (isOrganizationStep) {
        await createOrganization({ name, description });
      } else {
        await createWorkspace({ name, description });
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>
            {isOrganizationStep ? 'Create your organization' : 'Create your workspace'}
          </CardTitle>
          <p className="text-sm text-app-faint">
            {isOrganizationStep
              ? `Welcome${user?.firstName ? `, ${user.firstName}` : ''}. Start by creating the organization that will own your systems.`
              : `Create the first workspace for ${currentOrganization?.name || 'your organization'}.`}
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label htmlFor="onboarding-name">
                {isOrganizationStep ? 'Organization name' : 'Workspace name'}
              </Label>
              <Input
                id="onboarding-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="onboarding-description">Description</Label>
              <Textarea
                id="onboarding-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button className="w-full" disabled={submitting || !name.trim()}>
              {submitting
                ? 'Saving...'
                : isOrganizationStep
                  ? 'Create Organization'
                  : 'Create Workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
