import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'chip' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Square, icon-only. Needs an aria-label. */
  icon?: boolean;
  children: ReactNode;
}

/**
 * Extracted from the CSS-only `.pp-btn` variants that were duplicated across
 * panels. Styling still lives in ui.css and is entirely token-driven.
 */
export function Button({
  variant = 'default',
  icon = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'pp-btn',
    variant !== 'default' ? `pp-btn--${variant}` : '',
    icon ? 'pp-btn--icon' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
