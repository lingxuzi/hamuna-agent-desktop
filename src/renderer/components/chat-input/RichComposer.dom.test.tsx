import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useRef, useState } from 'react';
import RichComposer, { asTextarea, type ComposerFacade } from './RichComposer';
import { caretOffset } from './composerModel';

function Harness({ onChange }: { onChange?: (v: string, c: number) => void }) {
  const facade = useRef<ComposerFacade | null>(null);
  const [value, setValue] = useState('');
  return (
    <RichComposer
      value={value}
      onChange={(v, c) => {
        setValue(v);
        onChange?.(v, c);
      }}
      facadeRef={facade}
      placeholder="说点什么"
    />
  );
}

const editor = () => screen.getByRole('textbox');

describe('RichComposer', () => {
  it('exposes a textarea-shaped facade', () => {
    const facade = createRef<ComposerFacade>();
    render(
      <RichComposer value="" onChange={() => {}} facadeRef={facade} placeholder="p" />,
    );
    const ta = asTextarea(facade.current);
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('');
    expect(typeof ta!.selectionStart).toBe('number');
    expect(() => ta!.setSelectionRange(0, 0)).not.toThrow();
    expect(() => ta!.focus()).not.toThrow();
  });

  it('reports typed text through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(editor());
    await user.keyboard('hello');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toBe('hello');
  });

  it('renders a completed marker as an inline chip', () => {
    const facade = createRef<ComposerFacade>();
    const { container } = render(
      <RichComposer value="/compact" onChange={() => {}} facadeRef={facade} placeholder="p" />,
    );
    const chip = container.querySelector('.cc-chip-skill');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('contenteditable')).toBe('false');
    expect(chip!.textContent).toBe('/compact');
  });

  it('keeps textContent equal to the plain value', () => {
    const facade = createRef<ComposerFacade>();
    render(
      <RichComposer value="前 /skill 后 @a/b.ts" onChange={() => {}} facadeRef={facade} placeholder="p" />,
    );
    expect(editor().textContent).toBe('前 /skill 后 @a/b.ts');
  });

  it('does not rewrite the DOM while a composition is active', () => {
    const facade = createRef<ComposerFacade>();
    const { container, rerender } = render(
      <RichComposer value="abc" onChange={() => {}} facadeRef={facade} placeholder="p" />,
    );
    const root = editor();
    fireEvent.compositionStart(root);
    rerender(<RichComposer value="/compact" onChange={() => {}} facadeRef={facade} placeholder="p" />);
    expect(container.querySelector('.cc-chip-skill')).toBeNull();
  });

  it('deletes a whole chip instead of letting it fall back to text', () => {
    const facade = createRef<ComposerFacade>();
    const onChange = vi.fn();
    render(
      <RichComposer value="/compact " onChange={onChange} facadeRef={facade} placeholder="p" />,
    );
    const root = editor();
    // Caret at the end of the value, past the chip.
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.keyDown(root, { key: 'Backspace' });
    // The chip and the whitespace that committed it go in one keystroke.
    expect(onChange).toHaveBeenCalledWith('', 0);
  });

  it('deletes the chip in front of the caret with Delete', () => {
    const facade = createRef<ComposerFacade>();
    const onChange = vi.fn();
    render(
      <RichComposer value="前 @a/b.ts" onChange={onChange} facadeRef={facade} placeholder="p" />,
    );
    const root = editor();
    // Caret right before the chip.
    const range = document.createRange();
    range.setStart(root.firstChild!, 2);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(onChange).toHaveBeenCalledWith('前 ', 2);
  });

  it('leaves a half-typed marker to the normal deletion', () => {
    const facade = createRef<ComposerFacade>();
    const onChange = vi.fn();
    render(<RichComposer value="/comp" onChange={onChange} facadeRef={facade} placeholder="p" />);
    const root = editor();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.keyDown(root, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('maps the caret to a text offset across a chip', () => {
    const facade = createRef<ComposerFacade>();
    render(<RichComposer value="/compact " onChange={() => {}} facadeRef={facade} placeholder="p" />);
    const root = editor();
    const sel = window.getSelection()!;
    const range = document.createRange();
    // Past the chip: the chip's own text counts towards the offset.
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(caretOffset(root)).toBe(9);
    // Inside the chip: the hidden "/" prefix counts too, so the offset stays
    // in step with the plain value.
    const chipText = root.querySelector('.cc-chip-skill')!.lastChild as Text;
    range.setStart(chipText, 3);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(caretOffset(root)).toBe(4);
  });

  it('keeps the caret and the focus when a chip appears while typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(editor());
    await user.keyboard('/compact');
    await user.keyboard(' ');
    const root = editor();
    expect(root.querySelector('.cc-chip-skill')).not.toBeNull();
    // The caret stays in the field — no re-focus needed — and it sits after
    // the chip, never inside it.
    expect(document.activeElement).toBe(root);
    expect(caretOffset(root)).toBe(9);
    expect(root.querySelector('.cc-chip-skill')!.contains(window.getSelection()!.anchorNode)).toBe(
      false,
    );
  });

  it('keeps the caret after the chip when the value changes programmatically', () => {
    const facade = createRef<ComposerFacade>();
    const { container, rerender } = render(
      <RichComposer value="hello" onChange={() => {}} facadeRef={facade} placeholder="p" />,
    );
    const root = editor();
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    rerender(
      <RichComposer value="hello /compact " onChange={() => {}} facadeRef={facade} placeholder="p" />,
    );
    expect(container.querySelector('.cc-chip-skill')).not.toBeNull();
    // The field keeps the focus and the caret lands after the new chip.
    expect(document.activeElement).toBe(root);
    expect(caretOffset(root)).toBe(15);
  });
});
