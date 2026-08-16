import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  HelpCircleIcon,
  Loading03Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

/* ------------------------------------------------------------------ Help */

/**
 * The UI stays terse; anything that needs explaining hides behind this.
 */
export function Help({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="help" ref={ref}>
      <button
        type="button"
        className="help-btn"
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
      >
        <HugeiconsIcon icon={HelpCircleIcon} size={15} strokeWidth={2} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            className={`help-pop${align === "right" ? " help-pop-right" : ""}`}
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            onMouseLeave={() => setOpen(false)}
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ---------------------------------------------------------------- Switch */

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <motion.span
        className="switch-thumb"
        layout
        transition={{ type: "spring", stiffness: 620, damping: 38 }}
      />
    </button>
  );
}

/* ------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ComponentProps<typeof HugeiconsIcon>["icon"] }[];
  onChange: (v: T) => void;
  name: string;
}) {
  const id = useId();
  return (
    <div className="segmented" role="group" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="seg-pill"
              transition={{ type: "spring", stiffness: 480, damping: 40 }}
            />
          )}
          {o.icon && <HugeiconsIcon icon={o.icon} size={17} strokeWidth={2} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Spinner */

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className="spin">
      <HugeiconsIcon icon={Loading03Icon} size={size} strokeWidth={2.4} />
    </span>
  );
}

/* ---------------------------------------------------------------- Dialog */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`dialog${wide ? " dialog-lg" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <h2>{title}</h2>
              </div>
              <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close">
                <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
              </button>
            </div>
            {description && <p className="dialog-desc">{description}</p>}
            {children}
            {actions && <div className="dialog-actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ----------------------------------------------------------------- Toast */

export type Toast = { id: number; kind: "ok" | "err"; text: string };

export function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      style={{
        position: "fixed",
        left: 24,
        bottom: 24,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 460, damping: 34 }}
            onClick={() => dismiss(t.id)}
            style={{
              background: t.kind === "ok" ? "var(--ink)" : "var(--neg)",
              color: t.kind === "ok" ? "var(--page)" : "#fff",
              padding: "12px 18px",
              borderRadius: 10,
              boxShadow: "var(--shadow-3)",
              fontSize: 13.5,
              fontWeight: 500,
              maxWidth: 460,
              cursor: "pointer",
            }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
