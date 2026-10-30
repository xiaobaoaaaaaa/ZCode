import { useState } from "react";
import { Loader2 } from "lucide-react";
import { DesktopCommandIds } from "@zcode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import type { ZCodeDataImportResult } from "./contract.js";

export function DataImportControl() {
  const platform = useOptionalPlatform();
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const [sourceDirectory, setSource] = useState("");
  const [destinationParent, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ZCodeDataImportResult | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const message = (key: string) => intl.formatMessage({ id: `settings.importData.${key}` });
  if (!platform?.importZCodeDirectory) return null;

  const pick = async (source: boolean) => {
    setBusy(true);
    try {
      const directory = await platform.selectDirectory();
      if (directory) {
        (source ? setSource : setDestination)(directory);
        setResult(null);
      }
    } catch {
      setResult({ ok: false, error: "copy-failed" });
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await platform.importZCodeDirectory!({ sourceDirectory, destinationParent }));
    } catch {
      setResult({ ok: false, error: "copy-failed" });
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    setRestartFailed(false);
    setRestarting(true);
    try {
      await platform.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
    } catch {
      setRestartFailed(true);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <>
      <SettingsRow
        label={message("title")}
        description={message("description")}
        control={
          <Button
            variant="outline"
            size="lg"
            data-testid="settings-import-data-open"
            onClick={() => setOpen(true)}
          >
            {message("open")}
          </Button>
        }
      />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy && !restarting) setOpen(value);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!busy && !restarting}
        >
          <DialogHeader>
            <DialogTitle>{message("title")}</DialogTitle>
            <DialogDescription>{message("description")}</DialogDescription>
          </DialogHeader>
          <p className="text-ui-sm text-foreground-subtle">{message("scope")}</p>
          <p className="text-ui-sm text-foreground-subtle">{message("notice")}</p>
          {([true, false] as const).map((source) => (
            <div key={String(source)} className="flex min-w-0 flex-col gap-2">
              <label
                className="text-ui-base"
                htmlFor={source ? "zcode-import-source" : "zcode-import-destination"}
              >
                {message(source ? "source" : "destination")}
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  id={source ? "zcode-import-source" : "zcode-import-destination"}
                  data-testid={
                    source ? "settings-import-data-source" : "settings-import-data-destination"
                  }
                  className="min-w-0 flex-1 font-mono"
                  value={source ? sourceDirectory : destinationParent}
                  readOnly
                  disabled={busy || result?.ok}
                />
                <Button
                  variant="outline"
                  disabled={busy || result?.ok}
                  data-testid={
                    source
                      ? "settings-import-data-pick-source"
                      : "settings-import-data-pick-destination"
                  }
                  onClick={() => void pick(source)}
                >
                  {message("browse")}
                </Button>
              </div>
            </div>
          ))}
          <div
            aria-live="polite"
            role="status"
            data-testid="settings-import-data-status"
            className="min-w-0 text-ui-sm"
          >
            {busy ? (
              <p className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {message("working")}
              </p>
            ) : null}
            {result?.ok ? (
              <>
                <p className="text-success">{message("ready")}</p>
                <p className="mt-2 break-all font-mono">{result.dataBaseDir}</p>
                <p className="mt-2 text-foreground-subtle">{message("restartNotice")}</p>
                {restartFailed ? (
                  <p className="mt-2 text-destructive">{message("restartFailed")}</p>
                ) : null}
              </>
            ) : result ? (
              <p className="text-destructive">{message(`error.${result.error}`)}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy || restarting} onClick={() => setOpen(false)}>
              {message(result?.ok ? "later" : "cancel")}
            </Button>
            {result?.ok ? (
              <Button
                data-testid="settings-import-data-restart"
                disabled={restarting}
                onClick={() => void restart()}
              >
                {message("restart")}
              </Button>
            ) : (
              <Button
                data-testid="settings-import-data-submit"
                disabled={busy || !sourceDirectory || !destinationParent}
                onClick={() => void submit()}
              >
                {message("submit")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
