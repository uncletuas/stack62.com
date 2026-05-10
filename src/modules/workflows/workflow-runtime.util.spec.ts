import { BadRequestException } from '@nestjs/common';
import {
  getStartStepKey,
  getWorkflowSteps,
  resolveNextStepKey,
} from './workflow-runtime.util';

describe('workflow runtime utilities', () => {
  const definition = {
    startStepKey: 'submit',
    steps: [
      { key: 'submit', next: 'review' },
      { key: 'review', onApprove: 'done', onReject: 'revise' },
      { key: 'revise', next: 'review' },
      { key: 'done' },
    ],
  };

  it('resolves valid steps and start step', () => {
    expect(getWorkflowSteps(definition).map((step) => step.key)).toEqual([
      'submit',
      'review',
      'revise',
      'done',
    ]);
    expect(getStartStepKey(definition)).toBe('submit');
  });

  it('advances by default next and approval branches', () => {
    expect(
      resolveNextStepKey({
        action: 'advance',
        definition,
        currentStepKey: 'submit',
      }),
    ).toBe('review');

    expect(
      resolveNextStepKey({
        action: 'approve',
        definition,
        currentStepKey: 'review',
      }),
    ).toBe('done');

    expect(
      resolveNextStepKey({
        action: 'reject',
        definition,
        currentStepKey: 'review',
      }),
    ).toBe('revise');
  });

  it('rejects transitions to missing steps', () => {
    expect(() =>
      resolveNextStepKey({
        action: 'advance',
        definition,
        currentStepKey: 'submit',
        requestedNextStepKey: 'ghost',
      }),
    ).toThrow(BadRequestException);
  });
});
