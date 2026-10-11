import { useRef, useState } from "react";

/** Digits only, at most 6 (leading zeros are kept: the value is always a string). */
export const digits6 = (v: string): string => v.replace(/\D/g, "").slice(0, 6);
/** A NEW code: exactly 6 digits. */
export const isNewSecret = (v: string): boolean => /^\d{6}$/.test(v);
/** An EXISTING password may hold letters or symbols: 6 visible characters. */
export const isAnySecret = (v: string): boolean => [...v].length === 6 && !/\s/.test(v);

interface Props {
  value: string;
  onChange(v: string): void;
  testid: string;
  /** « new » : a code being CHOSEN (6 digits, numeric keypad, nothing suggested by the phone).
   *  « current » : the existing password (numeric keypad first, with a switch to the full keyboard). */
  kind: "new" | "current";
  required?: boolean;
}

/** Masked 6-digit entry. Opens the numeric keypad on Android and iPhone; never lets the phone suggest or generate a password. */
export function SecretInput({ value, onChange, testid, kind, required = true }: Props) {
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const isNew = kind === "new";
  const toggle = () => {
    setFull((f) => !f);
    // The keyboard only changes when the field is focused again.
    requestAnimationFrame(() => {
      ref.current?.blur();
      ref.current?.focus();
    });
  };
  return (
    <>
      <input
        ref={ref}
        type="password"
        inputMode={isNew || !full ? "numeric" : "text"}
        pattern={isNew || !full ? "[0-9]*" : undefined}
        maxLength={6}
        value={value}
        onChange={(e) => onChange(isNew ? digits6(e.target.value) : e.target.value.replace(/\s/g, "").slice(0, 6))}
        autoComplete={isNew ? "off" : "current-password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required={required}
        data-testid={testid}
      />
      {!isNew && (
        <button type="button" className="linkbtn linkbtn--inline kbtoggle" aria-pressed={full} data-testid={`${testid}-kb`} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
          {full ? "Clavier numérique" : "Clavier complet"}
        </button>
      )}
    </>
  );
}
