import { useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

import type { ConversationVersion, ConversationVersionsContract } from "./contract.js";

export function ConversationVersions({ disabled, load, restore }: ConversationVersionsContract) {
  const { intl, locale } = useZCodeIntl();
  const [versions, setVersions] = useState<ConversationVersion[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function showVersions() {
    if (versions) {
      setVersions(null);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const loaded = await load();
      setVersions(loaded);
      setSelected(loaded.at(-1)?.id ?? "");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function restoreSelected() {
    setBusy(true);
    setError(false);
    try {
      await restore(selected);
      setVersions(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="px-4 py-1 text-ui-caption text-foreground-subtle">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || busy}
        onClick={() => void showVersions()}
      >
        {intl.formatMessage({ id: "chat.versions.open" })}
      </Button>
      {versions && (
        <div className="flex flex-wrap items-center gap-2 py-2">
          <p className="w-full">{intl.formatMessage({ id: "chat.versions.warning" })}</p>
          {versions.length === 0 ? (
            <p>{intl.formatMessage({ id: "chat.versions.empty" })}</p>
          ) : (
            <>
              <select
                aria-label={intl.formatMessage({ id: "chat.versions.open" })}
                className="rounded border border-border bg-background px-2 py-1 text-ui-caption"
                value={selected}
                disabled={disabled || busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                {[...versions].reverse().map((version, index) => (
                  <option key={version.id} value={version.id}>
                    {versions.length - index} · {new Date(version.createdAt).toLocaleString(locale)}{" "}
                    · {version.messageCount}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || busy || !selected}
                onClick={() => void restoreSelected()}
              >
                {intl.formatMessage({ id: "chat.versions.restore" })}
              </Button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{intl.formatMessage({ id: "chat.versions.error" })}</p>}
    </div>
  );
}
