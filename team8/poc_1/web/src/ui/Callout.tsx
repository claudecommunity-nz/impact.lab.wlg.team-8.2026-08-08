import type { ReactNode } from 'react';

export interface CalloutProps {
  intent: 'info' | 'limitation' | 'refusal';
  title: string;
  children: ReactNode;
  /** limitation and refusal callouts are never dismissible. */
  persistent?: boolean;
}

/** The honesty component: the 111 line, T+1, and the refusal banner. */
export function Callout({ intent, title, children, persistent }: CalloutProps) {
  const locked = persistent ?? intent !== 'info';
  return (
    <div
      className="pp-callout"
      data-intent={intent}
      role={intent === 'refusal' ? 'alert' : 'note'}
    >
      <strong className="pp-t-body-lg pp-callout__title">{title}</strong>
      <div className="pp-t-body pp-callout__body">{children}</div>
      {locked && (
        <span className="pp-t-caption pp-callout__persist">
          This notice cannot be dismissed.
        </span>
      )}
    </div>
  );
}
