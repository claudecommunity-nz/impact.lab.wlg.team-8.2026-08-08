import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Rendered as the dialog's heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  /** Constrain the dialog width; defaults to a readable measure. */
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Scrim + focus-trapped dialog. Deliberately hand-rolled rather than <dialog>:
 * ::backdrop cannot read our custom properties, so the scrim could not be
 * palette-driven, and this codebase's one rule is that every colour comes from
 * a token.
 */
export function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  width = 680,
  children,
  footer,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    // Focus the panel itself, not the first control — a dialog that opens with
    // the dismiss button focused reads as "get rid of me".
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div className="pp-modal" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="pp-modal__panel"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!hideTitle && <h2 className="pp-modal__title">{title}</h2>}
        <div className="pp-modal__body">{children}</div>
        {footer && <div className="pp-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
