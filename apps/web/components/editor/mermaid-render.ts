/**
 * Mermaid 渲染的纯函数层：动态加载 + 把 `render` 的成功 / 失败收敛成一个结构化结果，
 * 块内预览与编辑浮层共用，单测只需 mock `mermaid` 模块。
 */

type MermaidRender = (id: string, text: string) => Promise<string>;

export type MermaidRenderResult = { svg: string; error: null } | { svg: ""; error: string };

// mermaid 体积大，动态按需加载，避免进首屏 bundle
let mermaidLoader: Promise<MermaidRender> | null = null;
export function loadMermaid(): Promise<MermaidRender> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      try {
        // suppressErrorRendering：语法错误直接抛出，不往 body 里画 mermaid 自带的错误图
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", suppressErrorRendering: true });
      } catch {
        /* 重复 initialize 在某些版本会抛错，忽略 */
      }
      return async (id: string, text: string) => {
        const { svg } = await mermaid.render(id, text);
        return svg;
      };
    });
  }
  return mermaidLoader;
}

let renderCounter = 0;
/**
 * 每次渲染都用新 id：`mermaid.render` 开头会把文档里同 id 的元素删掉，
 * 复用 id 会让已经挂在块内 / 预览区的 svg 在重渲期间从 DOM 消失，失败时也无法保留上一张图。
 */
export function nextMermaidRenderId(): string {
  return `organize-mermaid-${++renderCounter}`;
}

export function describeMermaidError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** 永不抛错：空源码视为失败，调用方自行决定是否用默认图 / 占位代替。 */
export async function renderMermaidPreview(code: string, id: string = nextMermaidRenderId()): Promise<MermaidRenderResult> {
  const text = code.trim();
  if (!text) return { svg: "", error: "图表源码为空" };
  try {
    const render = await loadMermaid();
    const svg = await render(id, text);
    return { svg, error: null };
  } catch (error) {
    return { svg: "", error: describeMermaidError(error) };
  }
}
