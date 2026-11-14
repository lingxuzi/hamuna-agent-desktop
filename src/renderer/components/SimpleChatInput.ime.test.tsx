import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImagePreviewProvider } from '@/context/ImagePreviewContext';

vi.mock('@/config/useConfigData', () => ({
  useConfigData: () => ({ config: { chatSendShortcut: 'enter' } }),
}));

import SimpleChatInput from './SimpleChatInput';
import { ToastProvider } from './Toast';

function renderInput(onSend = vi.fn()) {
  render(
    <ToastProvider>
      <ImagePreviewProvider>
        <SimpleChatInput
          mode="launcher"
          runtime="codex"
          isLoading={false}
          onSend={onSend}
        />
      </ImagePreviewProvider>
    </ToastProvider>,
  );
  return onSend;
}

describe('SimpleChatInput IME submission guard', () => {
  it('does not send from the button while IME composition is active', () => {
    const onSend = renderInput();
    // The composer is a contentEditable (RichComposer), not a <textarea>: seed
    // text by writing textContent and firing input, the way a real edit lands.
    const editor = screen.getByRole('textbox');

    editor.textContent = '输入法提交测试';
    fireEvent.input(editor);
    fireEvent.compositionStart(editor);
    fireEvent.click(screen.getByTitle(/发送/));

    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(editor);
    fireEvent.click(screen.getByTitle(/发送/));

    expect(onSend).toHaveBeenCalledWith('输入法提交测试', undefined);
  });
});
