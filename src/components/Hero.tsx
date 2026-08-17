import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun03Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { NavLink } from "react-router-dom";
import { useTheme } from "../lib/theme.tsx";
import type { Pricing, Settings } from "../lib/api.ts";
import { istTime } from "../lib/format.ts";
import { Help } from "./ui.tsx";

export function Hero({
  settings,
  pricing,
  onOpenSettings,
}: {
  settings: Settings | null;
  pricing: Pricing | null;
  onOpenSettings: () => void;
}) {
  const { theme, toggle } = useTheme();
  const open = pricing?.marketOpen ?? settings?.marketOpen ?? false;

  return (
    <header className="hero">
      {/* Swap public/Logo Name copy.svg to change the wordmark. */}
      <img src="/Logo Name copy.svg" alt="Portfolio" className="hero-logo" />

      <nav className="hero-nav" aria-label="Main">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          Portfolio
        </NavLink>
        <NavLink
          to="/rebalance"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          Rebalance
        </NavLink>
      </nav>

      <div className="hero-actions">
        <span className={`pill ${open ? "pill-live" : ""}`} title="NSE cash session">
          <span className={`dot ${open ? "dot-pulse" : ""}`} />
          {open ? "Market open" : "Market closed"}
        </span>

        {pricing?.delayedByMinutes ? (
          <span className="pill" style={{ paddingRight: 6 }}>
            Yahoo +{pricing.delayedByMinutes}m
            {pricing.latestQuoteTime ? ` · ${istTime(pricing.latestQuoteTime)}` : ""}
            <Help align="right">
              Holdings prices come straight from Dhan and are real time. Yahoo
              Finance supplies the previous close and any ticker you don't own
              yet — its NSE feed runs {pricing.delayedByMinutes} minutes behind,
              and it is intraday, not yesterday's close.
            </Help>
          </span>
        ) : null}

        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          title={theme === "light" ? "Dark theme" : "Light theme"}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              style={{ display: "grid", placeItems: "center" }}
            >
              <HugeiconsIcon
                icon={theme === "light" ? Moon02Icon : Sun03Icon}
                size={20}
                strokeWidth={2}
              />
            </motion.span>
          </AnimatePresence>
        </button>

        <button
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Dhan credentials"
          style={{ position: "relative" }}
        >
          <HugeiconsIcon icon={Settings02Icon} size={20} strokeWidth={2} />
          {settings && !settings.connected && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 7,
                right: 7,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--neg)",
                border: "2px solid var(--page)",
              }}
            />
          )}
        </button>
      </div>
    </header>
  );
}
