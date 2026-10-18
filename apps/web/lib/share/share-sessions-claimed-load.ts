export const SHARE_SESSIONS_CLAIMED_LOAD_ERROR_HINT = "名额占用读取失败，显示可能不准确";

export type ShareSessionsClaimed = {
  active: number;
  released: number;
  ips: string[];
};

export type ShareSessionsClaimedLoadOutcome =
  | { ok: true; claimed: ShareSessionsClaimed }
  | { ok: false; error: string };

export function nextShareSessionsClaimedAfterLoad(
  previous: ShareSessionsClaimed | null,
  outcome: ShareSessionsClaimedLoadOutcome
): { claimed: ShareSessionsClaimed | null; loadError: string | null } {
  if (outcome.ok) {
    return { claimed: outcome.claimed, loadError: null };
  }
  return { claimed: previous, loadError: outcome.error };
}
