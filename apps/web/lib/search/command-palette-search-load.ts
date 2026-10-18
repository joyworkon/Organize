export const COMMAND_PALETTE_SEARCH_ERROR_MESSAGE = "搜索失败";

export type CommandPaletteSearchCounts = {
  reading: number;
  note: number;
  task: number;
  lesson: number;
  tag: number;
  memo: number;
};

type CommandPaletteSearchLoadInput<T> = {
  previousResults: T[];
  previousCounts: CommandPaletteSearchCounts;
} & (
  | { ok: true; results: T[]; counts: CommandPaletteSearchCounts }
  | { ok: false }
);

export function nextCommandPaletteSearchAfterLoad<T>(
  input: CommandPaletteSearchLoadInput<T>,
): {
  results: T[];
  counts: CommandPaletteSearchCounts;
  loadError: string | null;
} {
  if (!input.ok) {
    return {
      results: input.previousResults,
      counts: input.previousCounts,
      loadError: COMMAND_PALETTE_SEARCH_ERROR_MESSAGE,
    };
  }

  return { results: input.results, counts: input.counts, loadError: null };
}
