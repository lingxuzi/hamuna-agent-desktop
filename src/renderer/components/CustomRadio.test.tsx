import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CustomRadio from './CustomRadio';

describe('CustomRadio', () => {
  it('renders a checked-by-default bubble with the label', () => {
    render(<CustomRadio name="g" value="a" checked onChange={() => {}} label="Option A" />);
    expect(screen.getByRole('radio', { name: 'Option A' })).toBeChecked();
    // checked state paints the accent bubble
    expect(screen.getByRole('radio')).toHaveClass('peer');
  });

  it('calls onChange when the label is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomRadio name="g" value="b" checked={false} onChange={onChange} label="Option B" />);
    await user.click(screen.getByRole('radio', { name: 'Option B' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('renders card-style children without a label prop', () => {
    render(
      <CustomRadio name="g" value="c" checked onChange={() => {}} bubbleAlign="start">
        <div>Card title</div>
      </CustomRadio>,
    );
    expect(screen.getByRole('radio')).toBeInTheDocument();
    expect(screen.getByText('Card title')).toBeInTheDocument();
  });
});
