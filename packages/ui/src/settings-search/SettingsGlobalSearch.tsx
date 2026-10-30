import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.js";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { createSettingsSearchIndex, searchSettings } from "./catalog.js";
import type { SettingsSearchOptions, SettingsSearchResult } from "./types.js";

export function SettingsGlobalSearch({
  options,
  onSelect,
}: {
  options: SettingsSearchOptions;
  onSelect: (result: SettingsSearchResult) => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isDesktop, isMacDesktop, isWindowsDesktop, hostPlatform } = options;
  const index = useMemo(
    () =>
      createSettingsSearchIndex(
        { isDesktop, isMacDesktop, isWindowsDesktop, hostPlatform },
        locale,
      ),
    [isDesktop, isMacDesktop, isWindowsDesktop, hostPlatform, locale],
  );
  const results = useMemo(() => searchSettings(index, query), [index, query]);
  const label = intl.formatMessage({ id: "settings.globalSearch.title" });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery("");
          selected.current = false;
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          aria-label={label}
          data-testid="settings-global-search-trigger"
          className="h-9 w-full justify-start gap-2 rounded-xl border border-input-border bg-input px-3 text-foreground-subtle max-lg:size-10 max-lg:justify-center max-lg:px-0"
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate max-lg:sr-only">{label}</span>
        </Button>
      </DialogTrigger>
      {/* Dialog 默认铺满可用宽度；搜索列表需限宽，避免宽屏下标题与关闭按钮距离过远。 */}
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (selected.current) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">
          {intl.formatMessage({ id: "settings.globalSearch.hint" })}
        </DialogDescription>
        <Command shouldFilter={false} loop>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <CommandInput
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder={label}
                aria-label={label}
                className="max-sm:text-mobile-input-safe"
              />
            </div>
            {query ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.globalSearch.clear" })}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X className="size-4" />
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {intl.formatMessage({ id: "common.close" })}
            </Button>
          </div>
          <CommandList className="max-h-[60dvh]" aria-label={label}>
            <CommandEmpty>{intl.formatMessage({ id: "settings.globalSearch.empty" })}</CommandEmpty>
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => {
                  selected.current = true;
                  setOpen(false);
                  onSelect({ ...result });
                }}
              >
                <div className="min-w-0 py-1">
                  <div className="text-ui-base font-medium">{result.title}</div>
                  {!result.sectionOnly ? (
                    <div className="text-ui-sm text-foreground-subtle">{result.sectionTitle}</div>
                  ) : null}
                  {result.description ? (
                    <div className="line-clamp-2 text-ui-sm text-foreground-subtle">
                      {result.description}
                    </div>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
