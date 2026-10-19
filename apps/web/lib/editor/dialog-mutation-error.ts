export function dialogMutationErrorMessage(input: {
  serverMessage?: unknown;
  networkError?: boolean;
  fallback: string;
}): string {
  if (input.networkError) return `网络异常，${input.fallback}`;
  const serverMessage =
    typeof input.serverMessage === "string" ? input.serverMessage.trim() : "";
  return serverMessage || input.fallback;
}
