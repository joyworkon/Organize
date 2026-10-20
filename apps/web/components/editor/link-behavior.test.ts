// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('TipTap keeps selected text on URL paste and links pasted/typed URLs', () => {
 vi.stubGlobal('ClipboardEvent', Event);
 const editor = new Editor({ extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" })], content: '<p>selected words</p>' });
 editor.commands.setTextSelection({ from: 1, to: 15 });
 editor.view.pasteText('https://example.com');
 expect(editor.getText()).toBe('selected words');
 expect(editor.getAttributes('link').href).toBe('https://example.com');
 editor.commands.setContent('<p></p>');
 editor.view.pasteText('https://example.com');
 expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].attrs?.href).toBe('https://example.com');
 editor.commands.setContent('<p></p>');
 editor.commands.insertContent('example.com');
 editor.commands.insertContent(' ');
 expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].attrs?.href).toBe('https://example.com');
 editor.destroy();
});
