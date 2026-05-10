import { BadRequestException } from '@nestjs/common';

export type WorkflowStepType =
  | 'timer'
  | 'delay'
  | 'notification'
  | 'webhook'
  | 'approval'
  | 'user_task'
  | 'coworker_task';

export interface WorkflowStepDefinition {
  key: string;
  name?: string;
  type?: WorkflowStepType | string;
  delaySeconds?: number;
  retry?: {
    maxRetries?: number;
    retryDelaySeconds?: number;
  };
  escalation?: {
    afterSeconds?: number;
    notifyRole?: string;
    message?: string;
  };
  config?: Record<string, unknown>;
  next?: string | null;
  onApprove?: string | null;
  onReject?: string | null;
}

export interface WorkflowRuntimeDefinition {
  startStepKey?: string | null;
  steps?: WorkflowStepDefinition[];
}

export type WorkflowRunAction =
  | 'advance'
  | 'approve'
  | 'reject'
  | 'complete'
  | 'cancel'
  | 'fail';

export function getWorkflowSteps(
  definition: Record<string, unknown>,
): WorkflowStepDefinition[] {
  const candidate = definition as WorkflowRuntimeDefinition;
  if (!Array.isArray(candidate.steps)) return [];

  return candidate.steps
    .filter((step): step is WorkflowStepDefinition => {
      return (
        typeof step === 'object' &&
        step !== null &&
        typeof step.key === 'string' &&
        step.key.trim().length > 0
      );
    })
    .map((step) => ({ ...step, key: step.key.trim() }));
}

export function getStartStepKey(definition: Record<string, unknown>) {
  const steps = getWorkflowSteps(definition);
  if (steps.length === 0) return null;

  const configured = (definition as WorkflowRuntimeDefinition).startStepKey;
  if (configured && steps.some((step) => step.key === configured)) {
    return configured;
  }

  return steps[0].key;
}

export function getWorkflowStep(
  definition: Record<string, unknown>,
  stepKey: string | null,
) {
  if (!stepKey) return null;
  return (
    getWorkflowSteps(definition).find((step) => step.key === stepKey) ?? null
  );
}

export function getStepNextRunAt(step: WorkflowStepDefinition | null) {
  if (!step) return null;
  const delaySeconds =
    typeof step.delaySeconds === 'number' && step.delaySeconds > 0
      ? step.delaySeconds
      : step.type === 'timer' || step.type === 'delay'
        ? 60
        : 0;

  if (delaySeconds <= 0) return new Date();
  return new Date(Date.now() + delaySeconds * 1000);
}

export function getStepEscalationAt(step: WorkflowStepDefinition | null) {
  const afterSeconds = step?.escalation?.afterSeconds;
  if (typeof afterSeconds !== 'number' || afterSeconds <= 0) return null;
  return new Date(Date.now() + afterSeconds * 1000);
}

export function getStepMaxRetries(step: WorkflowStepDefinition | null) {
  const configured = step?.retry?.maxRetries;
  return typeof configured === 'number' && configured >= 0 ? configured : 3;
}

export function getStepRetryDelay(
  step: Pick<WorkflowStepDefinition, 'retry'> | null,
) {
  const configured = step?.retry?.retryDelaySeconds;
  return typeof configured === 'number' && configured > 0 ? configured : 30;
}

export function resolveNextStepKey(params: {
  action: WorkflowRunAction;
  definition: Record<string, unknown>;
  currentStepKey: string | null;
  requestedNextStepKey?: string | null;
}) {
  const { action, definition, currentStepKey, requestedNextStepKey } = params;
  if (['complete', 'cancel', 'fail'].includes(action)) return null;
  if (requestedNextStepKey) {
    assertStepExists(definition, requestedNextStepKey);
    return requestedNextStepKey;
  }

  const steps = getWorkflowSteps(definition);
  const current = steps.find((step) => step.key === currentStepKey);
  if (!current) {
    throw new BadRequestException('Current workflow step is invalid.');
  }

  const next =
    action === 'approve'
      ? (current.onApprove ?? current.next ?? null)
      : action === 'reject'
        ? (current.onReject ?? null)
        : (current.next ?? null);

  if (next) {
    assertStepExists(definition, next);
  }

  return next;
}

function assertStepExists(
  definition: Record<string, unknown>,
  stepKey: string,
) {
  const exists = getWorkflowSteps(definition).some(
    (step) => step.key === stepKey,
  );
  if (!exists) {
    throw new BadRequestException(`Workflow step '${stepKey}' does not exist.`);
  }
}
