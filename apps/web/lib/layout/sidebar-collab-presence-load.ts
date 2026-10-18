export const SIDEBAR_HAS_SHARED_NOTES_LOAD_ERROR_HINT = "与我共享状态读取失败";
export const SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT = "协作空间状态读取失败";

export type PresenceLoadOutcome =
  | { ok: true; has: boolean }
  | { ok: false; error: string };

export function nextSidebarPresenceAfterLoad(
  previous: boolean | null,
  outcome: PresenceLoadOutcome
): { has: boolean; loadError: string | null } {
  if (outcome.ok) {
    return { has: outcome.has, loadError: null };
  }
  return {
    has: previous === null ? true : previous,
    loadError: outcome.error,
  };
}
