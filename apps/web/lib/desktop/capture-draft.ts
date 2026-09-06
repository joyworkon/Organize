/** Acknowledgements belong to a user session and draft revision, not a React closure. */
export interface CaptureSubmission { userId: string; epoch: number; revision: number; id: string; content: string }
export class CaptureDraft {
  userId: string | null = null;
  content = "";
  private epoch = 0;
  private revision = 0;
  private submission: CaptureSubmission | null = null;
  reset(userId: string | null, content = "") {
    this.userId = userId; this.content = content; this.epoch++; this.revision++; this.submission = null;
  }
  edit(content: string) { this.content = content; this.revision++; this.submission = null; }
  begin(): CaptureSubmission | null {
    if (!this.userId || !this.content.trim()) return null;
    return this.submission ??= { userId: this.userId, epoch: this.epoch, revision: this.revision, id: crypto.randomUUID(), content: this.content.trim() };
  }
  belongsToCurrentUser(token: CaptureSubmission) { return token.userId === this.userId && token.epoch === this.epoch; }
  acknowledge(token: CaptureSubmission): boolean {
    if (!this.belongsToCurrentUser(token) || token.revision !== this.revision) return false;
    this.edit(""); return true;
  }
}
