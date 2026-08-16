import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { api, type Settings } from "../lib/api.ts";
import { timeAgo } from "../lib/format.ts";
import { Dialog, Help, Spinner } from "./ui.tsx";

export function SettingsSheet({
  open,
  onClose,
  settings,
  onSaved,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings | null;
  onSaved: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setClientId(settings?.clientId ?? "");
      setToken("");
      setError(null);
    }
  }, [open, settings?.clientId]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings(clientId.trim(), token.trim());
      notify("ok", "Connected to Dhan");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await api.disconnect();
    notify("ok", "Credentials cleared");
    onSaved();
    onClose();
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.syncInstruments();
      notify("ok", `${r.count.toLocaleString("en-IN")} NSE instruments refreshed`);
      onSaved();
    } catch (e) {
      notify("err", (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const canSave = clientId.trim().length > 0 && token.trim().length > 20;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dhan account"
      description="Stored locally in data/portfolio.sqlite on this machine. Nothing leaves your network except calls to Dhan and Yahoo Finance."
      actions={
        <>
          {settings?.connected && (
            <button className="btn btn-text" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          )}
          <button className="btn btn-tonal" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-filled" onClick={save} disabled={!canSave || busy}>
            {busy && <Spinner />}
            {busy ? "Verifying" : "Save"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {settings?.connected && (
          <div className="banner banner-info" style={{ alignItems: "center" }}>
            <span style={{ color: "var(--pos)", display: "grid", placeItems: "center" }}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={2} />
            </span>
            <span>
              Connected as <b>{settings.clientId}</b>. Re-enter both fields to replace the
              token — Dhan tokens expire every 24 hours.
            </span>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="cid">
            Dhan Client ID
          </label>
          <input
            id="cid"
            className="input mono"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="1102047240"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="tok">
            Access token
            <Help>
              Dhan web → Profile → DhanHQ Trading API → generate an access token.
              It is a JWT valid for 24 hours, so expect to paste a fresh one each
              trading day.
            </Help>
          </label>
          <textarea
            id="tok"
            className="textarea mono"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={settings?.tokenSet ? "•••••••••  paste a new token to replace" : "eyJ0eXAiOiJKV1Qi…"}
            style={{ minHeight: 92, fontSize: 12, wordBreak: "break-all" }}
            spellCheck={false}
          />
        </div>

        {error && <div className="banner banner-neg">{error}</div>}

        <div
          className="row"
          style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14 }}
        >
          <div className="grow">
            <div style={{ fontSize: 13, fontWeight: 500 }}>NSE instrument list</div>
            <div className="sub">
              {settings?.instrumentCount?.toLocaleString("en-IN") ?? 0} scrips ·
              updated {timeAgo(settings?.instrumentsSyncedAt ?? null)}
            </div>
          </div>
          <button className="btn btn-outlined btn-sm" onClick={sync} disabled={syncing}>
            {syncing ? <Spinner size={14} /> : <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={2} />}
            Refresh
          </button>
        </div>
      </div>
    </Dialog>
  );
}
