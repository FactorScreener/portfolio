import { useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkBackwardIcon } from "@hugeicons/core-free-icons";
import { ApiError, api, type Overview, type Settings } from "./lib/api.ts";
import { Hero } from "./components/Hero.tsx";
import { SettingsSheet } from "./components/SettingsSheet.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";
import { RebalancePage } from "./pages/RebalancePage.tsx";
import { Toasts, type Toast } from "./components/ui.tsx";

/** Refresh holdings and positions this often while NSE is trading. */
const LIVE_POLL_MS = 30_000;

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((kind: "ok" | "err", text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "ok" ? 4000 : 8000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const d = await api.overview();
      setOverview(d);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setOverview(null);
        setError(e.message);
        if (e.expired) notify("err", "Dhan token rejected — paste a fresh one.");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settings?.connected) void loadOverview();
  }, [settings?.connected, loadOverview]);

  // Poll only while the session is live; a closed market has nothing new.
  useEffect(() => {
    if (!settings?.connected || !overview?.pricing.marketOpen) return;
    const t = setInterval(() => void loadOverview(true), LIVE_POLL_MS);
    return () => clearInterval(t);
  }, [settings?.connected, overview?.pricing.marketOpen, loadOverview]);

  const connected = settings?.connected ?? false;

  return (
    <div className="shell">
      <Hero
        settings={settings}
        pricing={overview?.pricing ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {!connected && settings && (
        <div className="card card-pad" style={{ marginTop: 24, textAlign: "center" }}>
          <div style={{ fontSize: 19, fontWeight: 500, marginBottom: 6 }}>
            Connect your Dhan account
          </div>
          <p style={{ color: "var(--ink-2)", margin: "0 auto 18px", maxWidth: 420 }}>
            Add your Client ID and a fresh access token to load holdings and place orders.
          </p>
          <button className="btn btn-filled" onClick={() => setSettingsOpen(true)}>
            <HugeiconsIcon icon={LinkBackwardIcon} size={17} strokeWidth={2} />
            Add credentials
          </button>
        </div>
      )}

      {connected && (
        <>
          {error && (
            <div className="banner banner-neg" style={{ marginTop: 18 }}>
              {error}
            </div>
          )}

          <Routes>
            <Route
              path="/"
              element={
                <PortfolioPage
                  overview={overview}
                  loading={loading}
                  fetchedAt={fetchedAt}
                  onRefresh={() => void loadOverview()}
                />
              }
            />
            <Route
              path="/rebalance"
              element={
                <RebalancePage
                  overview={overview}
                  onDone={() => void loadOverview()}
                  notify={notify}
                />
              }
            />
          </Routes>
        </>
      )}

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaved={() => void loadSettings()}
        notify={notify}
      />

      <Toasts items={toasts} dismiss={dismiss} />
    </div>
  );
}
