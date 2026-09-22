import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Field({ label, hint, error, children, className, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className || ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={`input select ${props.className || ''}`}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`input ${props.className || ''}`} />;
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`check ${checked ? 'is-checked' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<K extends string>({ options, value, onChange }: { options: { value: K; label: ReactNode }[]; value: K; onChange: (v: K) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === value} key={o.value} className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Numeric input that keeps a string while typing and reports numbers. */
export function NumberInput({ value, onChange, min, max, step, placeholder, prefix, ...rest }: { value: number | '' | null | undefined; onChange: (v: number | '') => void; min?: number; max?: number; step?: number; placeholder?: string; prefix?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'>) {
  const input = (
    <input
      {...rest}
      className={`input ${prefix ? 'has-prefix' : ''}`}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step || 1}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
  if (!prefix) return input;
  return (
    <span className="input-prefix-wrap">
      <span className="input-prefix">{prefix}</span>
      {input}
    </span>
  );
}
