/**
 * mammoth 类型声明（包内 lib/index.d.ts 存在但 package.json 未声明 types，
 * moduleResolution=bundler 不会自动解析；内容同 node_modules/mammoth/lib/index.d.ts）。
 */
declare module "mammoth" {
  interface InputPath { path: string; }
  interface InputBuffer { buffer: Buffer; }
  interface InputArrayBuffer { arrayBuffer: ArrayBuffer; }
  type Input = InputPath | InputBuffer | InputArrayBuffer;

  interface ImageAttributes { src: string; }

  interface Image {
    contentType: string;
    readAsArrayBuffer: () => Promise<ArrayBuffer>;
    readAsBase64String: () => Promise<string>;
    readAsBuffer: () => Promise<Buffer>;
    read: {
      (): Promise<Buffer>;
      (encoding: string): Promise<string>;
    };
  }

  interface Options {
    styleMap?: string | string[];
    includeEmbeddedStyleMap?: boolean;
    includeDefaultStyleMap?: boolean;
    convertImage?: unknown;
    ignoreEmptyParagraphs?: boolean;
    idPrefix?: string;
    /** 禁用外部文件访问（任务 0 选型：防目录穿越） */
    externalFileAccess?: boolean | { readonly allowNetwork: boolean; readonly allowFileSystem: boolean };
    transformDocument?: (element: unknown) => unknown;
  }

  interface MessageWarning { type: "warning"; message: string; }
  interface MessageError { type: "error"; message: string; error: unknown; }
  interface Result {
    value: string;
    messages: Array<MessageWarning | MessageError>;
  }

  interface Mammoth {
    convertToHtml: (input: Input, options?: Options) => Promise<Result>;
    extractRawText: (input: Input) => Promise<Result>;
    embedStyleMap: (input: Input, styleMap: string) => Promise<{
      toArrayBuffer: () => ArrayBuffer;
      toBuffer: () => Buffer;
    }>;
    images: {
      dataUri: unknown;
      imgElement: (f: (image: Image) => Promise<ImageAttributes>) => unknown;
    };
  }

  const mammoth: Mammoth;
  export = mammoth;
}
