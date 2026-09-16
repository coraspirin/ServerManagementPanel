import { formatBytes } from "@/lib/metrics/catalog";
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
          <div className="border-b border-line px-5 py-3">
            <h3 className="font-semibold">{t("maintenance.backup.title")}</h3>
            <p className="mt-0.5 text-xs text-subtle">
              {backup.watching ? backup.dir : t("maintenance.backup.off")}
            </p>
          </div>

          <div className="px-5 py-3 text-sm">
            {!backup.watching ? (
              <p className="text-subtle">
                {t("maintenance.backup.setup")}
              </p>
            ) : backup.error ? (
              <p className="text-danger">{backup.error}</p>
            ) : backup.newestAt === null ? (
              <p className="text-danger">{t("maintenance.backup.empty")}</p>
            ) : (
              <>
                <p className={backup.stale ? "text-danger" : "text-ok"}>
                  {t("maintenance.backup.latest", { when: ago(backup.newestAt) })}
                  {backup.stale &&
                    t("maintenance.backup.threshold", { hours: backup.staleAfterHours })}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {backup.newestName} ·{" "}
                  {t("maintenance.backup.files", { count: backup.fileCount })} ·{" "}
                  {formatBytes(backup.totalBytes)}
                </p>
              </>
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
