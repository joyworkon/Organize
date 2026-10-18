import { describe, expect, it } from "vitest";
import {
  NOTE_CONTENT_LINK_STATES_LOAD_ERROR_MESSAGE,
  nextContentLinkStatesAfterLoad,
} from "./content-link-states-load";

describe("nextContentLinkStatesAfterLoad", () => {
  it("replaces the previous snapshot and clears the error on success", () => {
    const states = { new: "new" };
    const result = nextContentLinkStatesAfterLoad({
      previous: { old: "old" },
      ok: true,
      states,
    });

    expect(result.states).toBe(states);
    expect(result.loadError).toBeNull();
  });

  it("keeps the previous snapshot by reference on failure", () => {
    const previous = { old: "old" };
    const result = nextContentLinkStatesAfterLoad({
      previous,
      ok: false,
      error: { message: "network down" },
    });

    expect(result.states).toBe(previous);
    expect(result.loadError).toBe("network down");
  });

  it("passes through the trimmed error message on failure", () => {
    const result = nextContentLinkStatesAfterLoad({
      previous: {},
      ok: false,
      error: { message: "  Failed to fetch  " },
    });

    expect(result.loadError).toBe("Failed to fetch");
  });

  it("keeps a first-load failure empty while exposing an error", () => {
    const previous: Record<string, string> = {};
    const result = nextContentLinkStatesAfterLoad({ previous, ok: false });

    expect(result.states).toBe(previous);
    expect(result.states).toEqual({});
    expect(result.loadError).toBe(NOTE_CONTENT_LINK_STATES_LOAD_ERROR_MESSAGE);
  });

  it("treats a successful empty map as a valid empty state", () => {
    const states: Record<string, string> = {};
    const result = nextContentLinkStatesAfterLoad({
      previous: { old: "old" },
      ok: true,
      states,
    });

    expect(result.states).toBe(states);
    expect(result.states).toEqual({});
    expect(result.loadError).toBeNull();
  });

  it("falls back to the standard message for a blank error message", () => {
    const previous = { old: "old" };
    const result = nextContentLinkStatesAfterLoad({
      previous,
      ok: false,
      error: { message: "   " },
    });

    expect(result.states).toBe(previous);
    expect(result.loadError).toBe(NOTE_CONTENT_LINK_STATES_LOAD_ERROR_MESSAGE);
  });
});
