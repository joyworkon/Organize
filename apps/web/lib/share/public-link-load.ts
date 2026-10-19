export interface SharePublicLinkInfo {
  token: string;
  url: string;
  is_public: boolean;
}

export const SHARE_PUBLIC_LINK_LOAD_ERROR_MESSAGE = "公开分享状态加载失败，请重试";

export function nextSharePublicLinkAfterLoad({
  previous,
  ok,
  data,
}: {
  previous: SharePublicLinkInfo | null;
  ok: boolean;
  data?: SharePublicLinkInfo | null;
}): {
  share: SharePublicLinkInfo | null;
  loadError: string | null;
} {
  if (!ok) {
    return {
      share: previous,
      loadError: SHARE_PUBLIC_LINK_LOAD_ERROR_MESSAGE,
    };
  }

  if (!data?.token) {
    return { share: null, loadError: null };
  }

  return {
    share: {
      token: data.token,
      url: data.url,
      is_public: data.is_public,
    },
    loadError: null,
  };
}
