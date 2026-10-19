export type BlockMutationResult = { ok: true } | { ok: false; message: string };

/**
 * 把数据库块写操作的 fetch 结果映射为成功或带文案的失败。
 * bodyError 为响应 json 的 error 字段（读不到时用 fallback 固定文案）。
 */
export function resolveBlockMutationResult(input: {
  ok: boolean;
  bodyError?: unknown;
  fallback: string;
}): BlockMutationResult {
  if (input.ok) return { ok: true };
  const bodyError = typeof input.bodyError === "string" ? input.bodyError.trim() : "";
  return { ok: false, message: bodyError || input.fallback };
}

/** 读取响应 json 的 error 字段；解析失败返回 undefined。 */
export async function readMutationError(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}
