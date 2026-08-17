import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);

  // The popover is portaled to <body>, so the button and popover are not
  // siblings in the DOM. A single hover region isn't possible, so we track
  // intent with a small grace period: leaving either element schedules a
  // close, and entering the other cancels it. Without this the popover
  // reopens when the pointer slides from the popover back onto the button
  // and then sticks around forever.
  const enter = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 120);
  };

  useEffect(() => () => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const r = pop.getBoundingClientRect();
    const margin = 8;
    let left = align === "right" ? b.right - r.width : b.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - r.width - margin));
    let top = b.bottom + margin;
    if (top + r.height > window.innerHeight - margin) {
      top = b.top - r.height - margin;
    }
    if (top < margin) top = margin;
    setPos({ left, top });
  }, [open, align, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      if (closeTimer.current != null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setOpen(false);
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
    <span className="help">
      <button
        ref={btnRef}
        type="button"
        className="help-btn"
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <HugeiconsIcon icon={HelpCircleIcon} size={15} strokeWidth={2} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.span
              ref={popRef}
              className="help-pop"
              role="tooltip"
              style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? "visible" : "hidden",
              }}
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
              onMouseEnter={enter}
              onMouseLeave={leave}
            >
              {children}
            </motion.span>
          )}
        </AnimatePresence>,
        document.body,
      )}
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

/* ------------------------------------------------------------ SideSwitch */

/**
 * Sell/Buy as one pill with a sliding thumb rather than two buttons: a run
 * only ever sends one side, and a switch says "either/or" louder than a pair
 * of buttons does. The thumb carries the side's colour so the choice reads
 * from across the room.
 */
export function SideSwitch<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string; tone?: "pos" | "neg" | "accent"; icon?: React.ComponentProps<typeof HugeiconsIcon>["icon"] }[];
  onChange: (v: T) => void;
  name: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const tone = options[index]?.tone ?? "accent";

  return (
    <div
      className="side-switch"
      role="radiogroup"
      aria-label={name}
      data-tone={tone}
      style={{ ["--count" as string]: options.length }}
    >
      <motion.span
        className="side-thumb"
        aria-hidden
        animate={{ x: `${index * 100}%` }}
        transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-on={value === o.value}
          data-tone={o.tone ?? "accent"}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <HugeiconsIcon icon={o.icon} size={16} strokeWidth={2.4} />}
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
