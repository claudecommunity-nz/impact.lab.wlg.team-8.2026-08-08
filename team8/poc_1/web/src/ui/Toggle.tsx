export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
  /** Why this is off. Rendered in place of the hint when disabled. */
  disabledReason?: string;
}

export function Toggle({ label, checked, onChange, hint, disabled, disabledReason }: ToggleProps) {
  const note = disabled ? (disabledReason ?? hint) : hint;
  return (
    <label className="pp-toggle" data-disabled={Boolean(disabled)}>
      <input
        className="pp-toggle__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className="pp-toggle__switch" data-checked={checked} aria-hidden="true">
        <span className="pp-toggle__knob" />
      </span>
      <span className="pp-toggle__text">
        <span className="pp-t-body pp-toggle__label">{label}</span>
        {note && <span className="pp-t-caption pp-toggle__hint">{note}</span>}
      </span>
    </label>
  );
}
