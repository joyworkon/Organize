export const AI_SETTINGS_LOAD_ERROR_MESSAGE = "AI 设置加载失败";

export type AISettingsView = {
  configured: boolean;
  base_url: string;
  text_model: string;
  transcription_model: string;
  api_key_masked: string;
  has_key: boolean;
};

type AISettingsLoadOutcome =
  | { ok: true; view: AISettingsView }
  | { ok: false; message?: string };

export function nextAiSettingsAfterLoad({
  previous,
  outcome,
}: {
  previous: AISettingsView | null;
  outcome: AISettingsLoadOutcome;
}): { view: AISettingsView | null; loadError: string | null } {
  if (outcome.ok) {
    return { view: outcome.view, loadError: null };
  }

  return {
    view: previous,
    loadError: outcome.message?.trim() || AI_SETTINGS_LOAD_ERROR_MESSAGE,
  };
}
