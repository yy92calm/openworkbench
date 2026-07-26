import { HardDrive, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Plain-language disclosure of what stays local vs. what is sent to the model
 * provider. Every statement here must stay true to the actual architecture -
 * when behavior changes, change this copy (and its i18n entries) in the same
 * commit.
 */
export function DataFlowCard({ model, workspace }: { model: string | null; workspace: string | null }) {
  const { t } = useI18n();
  return (
    <section className="mt-5 rounded-card border border-border bg-surface shadow-card">
      <header className="border-b border-border px-5 py-3">
        <h2 className="font-serif text-[15px] text-text">{t("settings.dataFlow.title")}</h2>
        <p className="mt-0.5 text-xs text-muted">{t("settings.dataFlow.subtitle")}</p>
      </header>
      <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
            <HardDrive size={14} className="text-ok" /> {t("settings.dataFlow.local")}
          </div>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-muted">
            <li>
              {t("settings.dataFlow.local1")}
              {workspace && <span className="font-mono text-xs"> ({workspace})</span>}.
            </li>
            <li>{t("settings.dataFlow.local2")}</li>
            <li>{t("settings.dataFlow.local3")}</li>
            <li>{t("settings.dataFlow.local4")}</li>
          </ul>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
            <Send size={14} className="text-warn" /> {t("settings.dataFlow.sent")}
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
              {model ?? t("settings.dataFlow.noModel")}
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-muted">
            <li>{t("settings.dataFlow.sent1")}</li>
            <li>{t("settings.dataFlow.sent2")}</li>
            <li>{t("settings.dataFlow.sent3")}</li>
          </ul>
          <p className="mt-2 text-xs text-muted">{t("settings.dataFlow.footnote")}</p>
        </div>
      </div>
    </section>
  );
}
