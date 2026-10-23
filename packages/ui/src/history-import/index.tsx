import { useRef, useState } from "react";
import { useZCodeTaskService } from "@/hooks/useZCodeTaskService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import type {
  HistoryImportService,
  HistoryImportPreview,
  HistoryImportReport,
} from "./contract.js";

export function OfficialHistoryImportSettings() {
  const service = useZCodeTaskService();
  return <HistoryImportSettingsView service={service} />;
}

export function HistoryImportSettingsView({ service }: { service: HistoryImportService }) {
  const { intl } = useZCodeIntl();
  const label = (key: string) => intl.formatMessage({ id: `settings.historyImport.${key}` });
  const [source, setSource] = useState("");
  const [closed, setClosed] = useState(false);
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null);
  const [report, setReport] = useState<HistoryImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const admitted = useRef(false);
  const reset = () => {
    setPreview(null);
    setReport(null);
    setError(null);
  };
  async function run(confirm: boolean) {
    if (admitted.current || !closed || !source.trim()) return;
    admitted.current = true;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      if (confirm && preview) {
        setReport(await service.confirmHistoryImport({ token: preview.token }));
        setPreview(null);
      } else {
        setPreview(null);
        setPreview(
          await service.previewHistoryImport({ source: source.trim(), sourceClosed: true }),
        );
      }
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  }
  return (
    <SettingsGroupCard>
      <SettingsRow label={label("title")} description={label("scope")} control={null} />
      <div className="space-y-3 px-4 py-3 text-ui-base">
        <p className="text-ui-caption text-foreground-subtle">{label("warning")}</p>
        <label className="block" htmlFor="history-import-source">
          {label("source")}
        </label>
        <input
          id="history-import-source"
          className="w-full rounded-lg border border-border bg-transparent p-3 text-ui-base"
          value={source}
          disabled={busy}
          onChange={(event) => {
            setSource(event.target.value);
            setClosed(false);
            reset();
          }}
        />
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={closed}
            disabled={busy}
            onChange={(event) => {
              setClosed(event.target.checked);
              reset();
            }}
          />
          {label("closed")}
        </label>
        <Button
          variant="outline"
          disabled={busy || !closed || !source.trim()}
          onClick={() => void run(false)}
        >
          {label("preview")}
        </Button>
        {preview && (
          <div role="status" className="space-y-2">
            <p>
              {intl.formatMessage(
                { id: "settings.historyImport.counts" },
                {
                  sessions: preview.sessions.length,
                  messages: preview.messages,
                  skipped: preview.skipped.length,
                },
              )}
            </p>
            <ul className="max-h-60 space-y-2 overflow-y-auto text-ui-caption">
              {preview.sessions.map((session) => (
                <li key={session.sourceKey} className="break-all">
                  {session.title} · {session.directory} · {session.messages}
                </li>
              ))}
              {preview.skipped.map((session) => (
                <li key={session.sourceSessionId} className="break-all">
                  {session.sourceSessionId}: {session.reason}
                </li>
              ))}
            </ul>
            <Button disabled={busy || !preview.sessions.length} onClick={() => void run(true)}>
              {label("confirm")}
            </Button>
          </div>
        )}
        {busy && <p role="status">{label("busy")}</p>}
        {report && (
          <div role="status">
            <p>
              {intl.formatMessage(
                { id: "settings.historyImport.result" },
                { imported: report.imported, duplicates: report.duplicates },
              )}
            </p>
            <p className="text-ui-caption">{label("resume")}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="break-all text-ui-caption text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsGroupCard>
  );
}
