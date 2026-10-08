import Link from "next/link";
import { formatBytes } from "@/lib/metrics/catalog";
import { backupOverview } from "@/lib/backup/overview";
import type { SystemCategory } from "@/lib/backup/types";
import { backupStatus } from "@/lib/backup/watch";
import { cachedImageUpdates } from "@/lib/updates";
import { osUpdateReport } from "@/lib/updates/os";
import { formatRelative } from "@/lib/i18n/format";
import { Rich } from "@/lib/i18n/rich";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { ImageUpdatePanel } from "./ImageUpdatePanel";

/**
 * Bakım durumu panelleri (M1.10).
 *
 * Üçü de aynı soruyu farklı yerlere soruyor: **"arkada sessizce bozulan bir
 * şey var mı?"** Bunlar bir arıza ekranı değil, gözden kaçanı görünür kılan
 * bir tarama. Hepsi aynı zamanda alarm koşulu üretiyor; panel açılmasa da
 * haber gelir.
 *
 * Panel güncelleme KURMAZ. Bir çekirdek güncellemesi yeniden başlatma ister;
 * bunu kendiliğinden yapan bir panel, çözdüğünden çok sorun çıkarır.
 */

export async function MaintenanceSection({ canAct }: { canAct: boolean }) {
  const [os, backup] = await Promise.all([osUpdateReport(), backupStatus()]);
  const images = cachedImageUpdates();
  const systems = backupOverview().systems;
  const t = getT();
  const dict = getActiveDictionary();
  const ago = (ts: number) => formatRelative(ts * 1000, dict);

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">{t("maintenance.title")}</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h3 className="font-semibold">{t("maintenance.os.title")}</h3>
            <p className="mt-0.5 text-xs text-subtle">
              {os.available && os.reportedAt
                ? t("maintenance.os.report", { when: ago(os.reportedAt) }) +
                  (os.stale ? t("maintenance.os.stale") : "")
                : t("maintenance.os.noReport")}
            </p>
          </div>

          <div className="px-5 py-3 text-sm">
            {!os.available ? (
              <>
                <p className="text-subtle">
                  {t("maintenance.os.setup")}
                </p>
                <pre className="mt-2 overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[11px]">
{`sudo install -m 700 scripts/os-updates.sh /usr/local/bin/panel-os-updates.sh
sudo tee /etc/cron.d/panel-os-updates <<EOF
17 6 * * * root PANEL_REPORTS_DIR=$PWD/reports /usr/local/bin/panel-os-updates.sh
EOF`}
                </pre>
              </>
            ) : os.total === 0 ? (
              <p className="text-ok">{t("maintenance.os.none")}</p>
            ) : (
              <>
                <p>
                  <Rich
                    text={t("maintenance.os.packages")}
                    values={{ count: <span className="font-medium">{os.total}</span> }}
                  />
                  {os.security > 0 && (
                    <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-medium text-warn">
                      {t("maintenance.os.security", { count: os.security })}
                    </span>
                  )}
                </p>
                {os.rebootRequired && (
                  <p className="mt-1 text-danger">{t("maintenance.os.reboot")}</p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-subtle">
                    {t("maintenance.os.packageList")}
                  </summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {os.packages.slice(0, 40).map((pkg) => (
                      <li key={pkg.name} className={pkg.security ? "text-warn" : "text-subtle"}>
                        {pkg.name} {pkg.current ?? "—"} → {pkg.candidate}
                      </li>
                    ))}
                  </ul>
                  {os.packages.length > 40 && (
                    <p className="mt-1 text-[11px] text-subtle">
                      {t("maintenance.os.more", { count: os.packages.length - 40 })}
                    </p>
                  )}
                </details>
              </>
            )}

            {os.errors.length > 0 && (
              <p className="mt-2 text-xs text-danger">{os.errors.join(" · ")}</p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h3 className="font-semibold">{t("maintenance.backup.title")}</h3>
            <Link href="/backup" className="text-xs text-brand hover:underline">
              {t("maintenance.backup.open")}
            </Link>
          </div>

          <div className="px-5 py-3 text-sm">
            {systems.every((system) => !system.configured) ? (
              <p className="text-subtle">{t("maintenance.backup.setup")}</p>
            ) : (
              <ul className="space-y-1">
                {systems.map((system) => (
                  <li key={system.category} className="flex items-center gap-2">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        system.state === "ok"
                          ? "bg-ok"
                          : system.state === "error"
                            ? "bg-danger"
                            : system.state === "warning"
                              ? "bg-warn"
                              : "bg-line"
                      }`}
                      aria-hidden
                    />
                    <span className="flex-1">{t(`backup.category.${system.category as SystemCategory}`)}</span>
                    <span className={`text-xs ${system.state === "error" ? "text-danger" : "text-subtle"}`}>
                      {!system.configured
                        ? t("backup.state.unset")
                        : system.lastSuccessAt
                          ? t("maintenance.backup.latest", { when: ago(system.lastSuccessAt) })
                          : t("backup.card.none")}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {backup.watching && (
              <p className={`mt-3 border-t border-line pt-2 text-xs ${backup.error || backup.stale ? "text-danger" : "text-subtle"}`}>
                {t("maintenance.backup.external", { dir: backup.dir })}{" "}
                {backup.error
                  ? backup.error
                  : backup.newestAt === null
                    ? t("maintenance.backup.empty")
                    : `${t("maintenance.backup.latest", { when: ago(backup.newestAt) })} · ${t("maintenance.backup.files", { count: backup.fileCount })} · ${formatBytes(backup.totalBytes)}`}
              </p>
            )}
          </div>
        </section>
      </div>

      <ImageUpdatePanel
        initial={images?.value ?? []}
        initialCheckedAt={images?.updatedAt ?? null}
        canAct={canAct}
      />
    </div>
  );
}
