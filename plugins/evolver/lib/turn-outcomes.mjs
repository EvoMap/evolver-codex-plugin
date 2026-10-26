const TURN_OUTCOMES = {
  completed: 'success',
  'max-tokens': 'failed',
  aborted: 'failed',
  blocked: 'failed',
  error: 'failed',
};

export function outcomeOfReason(reasonKind) {
  return TURN_OUTCOMES[reasonKind] ?? null;
}
