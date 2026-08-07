import { useId, useState, type ReactNode } from 'react';

export interface PanelProps {
  title: string;
  subtitle?: string;
  /** 'blind' = refusal-mode styling: hatched, desaturated, not an error state. */
  tone?: 'default' | 'warn' | 'blind';
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Per-panel caveats live here and are always rendered when present. */
  footnote?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** The only chrome. Every box on screen is one of these. */
export function Panel({
  title,
  subtitle,
  tone = 'default',
  collapsible = false,
  defaultOpen = true,
  footnote,
  actions,
  children,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const isOpen = collapsible ? open : true;

  const head = (
    <>
      <div className="pp-panel__titles">
        <h2 className="pp-t-h3 pp-panel__title">{title}</h2>
        {subtitle && <p className="pp-t-caption pp-panel__subtitle">{subtitle}</p>}
      </div>
      {actions}
      {collapsible && (
        <span className="pp-panel__chevron" data-open={isOpen} aria-hidden="true">
          ▾
        </span>
      )}
    </>
  );

  return (
    <section className="pp-panel" data-tone={tone}>
      {collapsible ? (
        <button
          type="button"
          className="pp-panel__head"
          data-collapsible="true"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {head}
        </button>
      ) : (
        <div className="pp-panel__head">{head}</div>
      )}
      {isOpen && (
        <div className="pp-panel__body" id={bodyId}>
          {children}
        </div>
      )}
      {footnote && <p className="pp-t-caption pp-panel__footnote">{footnote}</p>}
    </section>
  );
}
