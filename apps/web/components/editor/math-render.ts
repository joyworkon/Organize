import katex from "katex";

/** KaTeX failure paths must treat user-controlled LaTeX as text. */
export function escapeMathHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMath(latex: string, isBlock: boolean, strict = false): { html: string; error: boolean } {
  try {
    const html = katex.renderToString(latex || "\\;", { throwOnError: strict, displayMode: isBlock });
    return { html, error: false };
  } catch {
    return { html: `<span class="text-destructive">${escapeMathHtml(latex)}</span>`, error: true };
  }
}
