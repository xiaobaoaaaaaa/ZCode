import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider, useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { AppearanceSectionContent } from "@/settingsCodePreview.js";
import {
  SettingsGlobalSearch,
  useSettingsSearchDestination,
  type SettingsSearchResult,
} from "@/settings-search/contract.js";
import { createSettingsPageConfig } from "@/settings/settingsPageConfig.js";
import "@/styles.css";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en-US" ? "en-US" : "zh-CN";
const theme = params.get("theme") === "dark" ? "zai-dark" : "zai-light";
document.documentElement.className =
  theme === "zai-dark" ? "dark theme-zai-dark" : "light theme-zai-light";
function Fixture() {
  const { intl } = useZCodeIntl();
  const [section, setSection] = useState("general");
  const [target, setTarget] = useState<SettingsSearchResult | null>(null);
  const ref = useSettingsSearchDestination(target);
  const [writes, setWrites] = useState(0);
  const sectionMeta = createSettingsPageConfig().settingsSections.find((s) => s.id === section)!;
  return (
    <div className="grid h-screen grid-cols-[68px_minmax(0,1fr)] bg-background text-foreground lg:grid-cols-[268px_minmax(0,1fr)]">
      <aside className="px-3 pt-14">
        <SettingsGlobalSearch
          options={{}}
          onSelect={(result) => {
            setSection(result.section);
            setTarget(result);
          }}
        />
      </aside>
      <main
        ref={ref}
        data-section={section}
        data-writes={writes}
        className="overflow-y-auto p-4 lg:p-8"
      >
        <h2
          tabIndex={-1}
          data-settings-search-id={`section:${section}`}
          className="mb-6 text-ui-settings-title"
        >
          {intl.formatMessage({ id: sectionMeta.titleId })}
        </h2>
        {section === "appearance" ? (
          <AppearanceSectionContent
            codePreviewSettings={{
              lightTheme: "github-light",
              darkTheme: "github-dark",
              showLineNumbers: true,
              wrapLongLines: false,
              fontSizePx: 14,
            }}
            setCodePreviewSettings={() => setWrites(writes + 1)}
            theme={theme}
            setTheme={() => setWrites(writes + 1)}
            uiFontSizePx={14}
            setUiFontSizePx={() => setWrites(writes + 1)}
          />
        ) : null}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={locale}>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </ZCodeIntlProvider>,
);
