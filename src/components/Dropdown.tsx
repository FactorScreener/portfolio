import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

export type DropdownOption<T extends string> = {
  value: T;
  label: string;
  /** Secondary line, e.g. what the column contains. */
  hint?: string;
};

/**
 * Listbox-style select. Native <select> cannot be themed, so the menu is ours.
 * It opens flat — no reveal — because a column picker is a means to an end.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  id,
  label,
  placeholder = "Select…",
  disabled,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  /** Ties the trigger to an external <label htmlFor>. */
  id?: string;
  /** Accessible name when there is no visible label. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Open onto whichever side has room, so a menu near the fold is not clipped.
  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const wanted = Math.min(options.length * 40 + 12, 288);
    setFlip(r.bottom + wanted + 16 > window.innerHeight && r.top > wanted + 16);
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted option in view during keyboard travel.
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="dd" ref={rootRef}>
      <button
        id={id}
        ref={btnRef}
        type="button"
        className="dd-btn"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${uid}-menu`}
        aria-haspopup="listbox"
        aria-label={label}
        aria-activedescendant={open ? `${uid}-opt-${active}` : undefined}
        data-open={open}
        data-empty={!selected}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="dd-value">{selected?.label ?? placeholder}</span>
        <span className="dd-chev">
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={2.2} />
        </span>
      </button>

      {open && (
        <ul
          id={`${uid}-menu`}
          ref={menuRef}
          className="dd-menu"
          role="listbox"
          aria-label={label}
          data-flip={flip}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${uid}-opt-${i}`}
              data-index={i}
              className="dd-opt"
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
            >
              <span className="dd-opt-text">
                <span className="dd-opt-label">{o.label}</span>
                {o.hint && <span className="sub">{o.hint}</span>}
              </span>
              {o.value === value && (
                <HugeiconsIcon icon={Tick02Icon} size={15} strokeWidth={2.6} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
