import { formatBytes } from "@/lib/metrics/catalog";
import { backupStatus } from "@/lib/backup/watch";
import { cachedImageUpdates } from "@/lib/updates";
import { osUpdateReport } from "@/lib/updates/os";
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
function ago(ts: number): string {
  const minutes = Math.floor((Date.now() / 1000 - ts) / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

export async function MaintenanceSection({ canAct }: { canAct: boolean }) {
  const [os, backup] = await Promise.all([osUpdateReport(), backupStatus()]);
  const images = cachedImageUpdates();

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Bakım durumu</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h3 className="font-semibold">İşletim sistemi güncellemeleri</h3>
            <p className="mt-0.5 text-xs text-subtle">
              {os.available && os.reportedAt
                ? `rapor: ${ago(os.reportedAt)}${os.stale ? " — eskimiş" : ""}`
                : "rapor yok"}
            </p>
          </div>

          <div className="px-5 py-3 text-sm">
            {!os.available ? (
              <>
                <p className="text-subtle">
                  Host&apos;ta güncelleme raporu üretilmiyor. `apt` host&apos;un paket
                  veritabanını okur ve root ister; bu yüzden panel değil, host&apos;ta
                  çalışan küçük bir script raporluyor.
                </p>
                <pre className="mt-2 overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[11px]">
{`sudo install -m 700 scripts/os-updates.sh /usr/local/bin/panel-os-updates.sh
sudo tee /etc/cron.d/panel-os-updates <<EOF
17 6 * * * root PANEL_REPORTS_DIR=$PWD/reports /usr/local/bin/panel-os-updates.sh
EOF`}
                </pre>
              </>
            ) : os.total === 0 ? (
              <p className="text-ok">Bekleyen güncelleme yok.</p>
            ) : (
              <>
                <p>
                  <span className="font-medium">{os.total}</span> paket güncellenebilir
                  {os.security > 0 && (
                    <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-medium text-warn">
                      {os.security} güvenlik
                    </span>
                  )}
                </p>
                {os.rebootRequired && (
                  <p className="mt-1 text-danger">Sunucu yeniden başlatma bekliyor.</p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-subtle">Paketler</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {os.packages.slice(0, 40).map((pkg) => (
                      <li key={pkg.name} className={pkg.security ? "text-warn" : "text-subtle"}>
                        {pkg.name} {pkg.current ?? "—"} → {pkg.candidate}
                      </li>
                    ))}
                  </ul>
                  {os.packages.length > 40 && (
                    <p className="mt-1 text-[11px] text-subtle">
                      …ve {os.packages.length - 40} paket daha
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
            <h3 className="font-semibold">Yedek takibi</h3>
            <p className="mt-0.5 text-xs text-subtle">
              {backup.watching ? backup.dir : "takip kapalı"}
            </p>
          </div>

          <div className="px-5 py-3 text-sm">
            {!backup.watching ? (
              <p className="text-subtle">
                Ayarlar → Güncelleme &amp; Yedek → &quot;İzlenecek yedek klasörü&quot;ne bir
                yol yazınca burada en son yedeğin yaşı görünür ve eskirse alarm üretilir.
                Yedekleme motoru M3.4&apos;te gelecek; bu yalnızca sessizce durmuş bir
                yedeklemeyi yakalar.
              </p>
            ) : backup.error ? (
              <p className="text-danger">{backup.error}</p>
            ) : backup.newestAt === null ? (
              <p className="text-danger">Klasör boş — hiç yedek yok.</p>
            ) : (
              <>
                <p className={backup.stale ? "text-danger" : "text-ok"}>
                  En son yedek {ago(backup.newestAt)}
                  {backup.stale && ` — eşik ${backup.staleAfterHours} saat`}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {backup.newestName} · {backup.fileCount} dosya ·{" "}
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
