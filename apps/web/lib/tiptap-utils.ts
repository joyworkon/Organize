import { JSONContent } from "@tiptap/core";

export function textToTiptap(paragraphs: string[]): JSONContent {
  return {
    type: "doc",
    content: paragraphs
      .filter(p => p.trim().length > 0)
      .map(p => ({
        type: "paragraph",
        content: p.trim() ? [{ type: "text", text: p.trim() }] : undefined
      }))
      .filter(n => n.content)
  };
}

export function htmlToTextParagraphs(html: string): string[] {
  if (typeof window === 'undefined') {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .split(/\n{2,}|\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs: string[] = [];
  const blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, div');
  blocks.forEach(el => {
    const text = el.textContent?.trim();
    if (text) paragraphs.push(text);
  });
  if (paragraphs.length === 0) {
    const allText = doc.body.textContent?.trim() || '';
    return allText.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }
  return paragraphs;
}
