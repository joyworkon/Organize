export function captureDraftStorageKey(userId: string): string {
  return `organize:dashboard-capture:${userId}`;
}

/** Clear only the value that was submitted; edits made while the request ran survive. */
export function draftAfterSubmit(current: string, submittedSnapshot: string): string {
  return current === submittedSnapshot ? "" : current;
}

export function isCaptureSubmissionCurrent(
  submittedUserId: string | null,
  submittedGeneration: number,
  currentUserId: string | null,
  currentGeneration: number,
): boolean {
  return submittedUserId === currentUserId && submittedGeneration === currentGeneration;
}
