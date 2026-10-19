import { describe, expect, it } from "vitest";
import {
  AI_SETTINGS_LOAD_ERROR_MESSAGE,
  nextAiSettingsAfterLoad,
  type AISettingsView,
} from "./settings-load";

const configuredView: AISettingsView = {
  configured: true,
  base_url: "https://api.example.com/v1",
  text_model: "gpt-4o-mini",
  transcription_model: "whisper-1",
  api_key_masked: "sk-...1234",
  has_key: true,
};

const unconfiguredView: AISettingsView = {
  configured: false,
  base_url: "",
  text_model: "",
  transcription_model: "",
  api_key_masked: "",
  has_key: false,
};

describe("nextAiSettingsAfterLoad", () => {
  it("replaces the previous view and clears the error on success", () => {
    const nextView = { ...configuredView, text_model: "gpt-4.1-mini" };
    const result = nextAiSettingsAfterLoad({
      previous: configuredView,
      outcome: { ok: true, view: nextView },
    });

    expect(result.view).toBe(nextView);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous view by reference and passes through a trimmed message", () => {
    const result = nextAiSettingsAfterLoad({
      previous: configuredView,
      outcome: { ok: false, message: "  网络暂时不可用  " },
    });

    expect(result.view).toBe(configuredView);
    expect(result.loadError).toBe("网络暂时不可用");
  });

  it("falls back to the standard message for a blank error message", () => {
    const result = nextAiSettingsAfterLoad({
      previous: configuredView,
      outcome: { ok: false, message: "   " },
    });

    expect(result.view).toBe(configuredView);
    expect(result.loadError).toBe(AI_SETTINGS_LOAD_ERROR_MESSAGE);
  });

  it("falls back to the standard message when no message is supplied", () => {
    const result = nextAiSettingsAfterLoad({
      previous: configuredView,
      outcome: { ok: false },
    });

    expect(result.view).toBe(configuredView);
    expect(result.loadError).toBe(AI_SETTINGS_LOAD_ERROR_MESSAGE);
  });

  it("keeps the view null when the first load fails", () => {
    const result = nextAiSettingsAfterLoad({
      previous: null,
      outcome: { ok: false },
    });

    expect(result.view).toBeNull();
    expect(result.loadError).toBe(AI_SETTINGS_LOAD_ERROR_MESSAGE);
  });

  it("treats a successfully loaded unconfigured view as valid", () => {
    const result = nextAiSettingsAfterLoad({
      previous: configuredView,
      outcome: { ok: true, view: unconfiguredView },
    });

    expect(result.view).toBe(unconfiguredView);
    expect(result.view?.configured).toBe(false);
    expect(result.loadError).toBeNull();
  });
});
