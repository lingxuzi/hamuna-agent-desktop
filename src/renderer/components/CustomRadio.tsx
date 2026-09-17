/**
 * CustomRadio — 替代原生 <input type="radio"> 的圆角单选控件。
 * 原生 radio 的 accent-color 圆圈在纸质感主题下视觉偏细、无法参与
 * 主题圆角/阴影体系；此处改为可主题化描边圈 + 内嵌实心点（设计稿
 * cTjk2 的圆角图标 chip 语言）。仍用原生 input 承载 a11y 状态。
 *
 * 用法：
 *   <CustomRadio name="group" value="a" checked label="文本" onChange={...} />
 *   <CustomRadio name="group" value="b" checked bubbleAlign="start" onChange={...}>
 *     <div>{多行卡片内容}</div>
 *   </CustomRadio>
 */

import type { InputHTMLAttributes, ReactNode } from 'react';

interface CustomRadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  /** 简洁单选标签（同行文本）。需要多行/自定义内容时改用 children。 */
  label?: ReactNode;
  /** 卡片式单选的任意内容（会替换 label） */
  children?: ReactNode;
  /** 圆点与内容的垂直对齐：'center'（单行 label）| 'start'（多行卡片） */
  bubbleAlign?: 'center' | 'start';
}

export default function CustomRadio({
  label,
  children,
  className,
  bubbleAlign = 'center',
  ...props
}: CustomRadioProps) {
  const content = children ?? label;
  if (content === undefined) {
    return <input type="radio" className="sr-only" {...props} />;
  }
  return (
    <label
      className={`group flex cursor-pointer select-none items-center gap-2 ${
        bubbleAlign === 'start' ? 'items-start' : ''
      } ${className ?? ''}`}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input type="radio" className="peer sr-only" {...props} />
        {/* 外圈 — 描边圆，focus 走 peer 伪类画 ring */}
        <span className="absolute inset-0 rounded-full border border-[var(--line-strong)] bg-[var(--paper)] transition-colors group-hover:border-[var(--ink-muted)] peer-checked:border-[var(--accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus-border)] peer-disabled:opacity-40" />
        {/* 内点 — checked 时淡入 */}
        <span className="relative h-2 w-2 rounded-full bg-[var(--accent)] opacity-0 transition-opacity peer-checked:opacity-100" />
      </span>
      <span className="min-w-0 flex-1 text-sm text-[var(--ink)]">{content}</span>
    </label>
  );
}
