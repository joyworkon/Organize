export const SPACES_MEMBER_NAMES_LOAD_ERROR_MESSAGE = "成员昵称加载失败，请重试";

export interface MemberProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

function memberNamesLoadError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return SPACES_MEMBER_NAMES_LOAD_ERROR_MESSAGE;
}

export function nextMemberProfilesAfterLoad({
  previousProfiles,
  data,
  error,
}: {
  previousProfiles: MemberProfileRow[];
  data: MemberProfileRow[] | null;
  error: unknown;
}): { profiles: MemberProfileRow[]; loadError: string | null } {
  if (error || data === null) {
    return {
      profiles: previousProfiles,
      loadError: memberNamesLoadError(error),
    };
  }
  return { profiles: data, loadError: null };
}
