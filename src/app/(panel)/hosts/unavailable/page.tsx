import { redirect } from "next/navigation";
import { CloudOff } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { resolvePageHost } from "@/lib/hosts/request";
import { getActiveDictionary, getT } from "@/lib/i18n/server";
import { translateLoose } from "@/lib/i18n/translate";

export const dynamic = "force-dynamic";

const REASONS = ["offline", "incompatible", "unsupported"] as const;
type Reason = (typeof REASONS)[number];

/**
 * Seçili sunucunun ekranı açılamadığında (ulaşılamıyor, uyumsuz ajan ya da
 * özellik o sunucuda yok). Üst bardan başka sunucu seçilince sayfa sunucuda
 * yeniden çizilir; sorun kalktıysa genel bakışa döner.
 */
export default async function HostUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  await requireSession();
  const t = getT();
  const dict = getActiveDictionary();
  const tk = (key: string, params?: Record<string, string>) => translateLoose(dict, key, params);
  const host = await resolvePageHost();
  const raw = (await searchParams).reason ?? "offline";
  const reason: Reason = (REASONS as readonly string[]).includes(raw) ? (raw as Reason) : "offline";

  const stillBlocked =
    reason === "unsupported"
      ? !host.isLocal
      : !host.isLocal && (host.status === "offline" || host.status === "incompatible");
  if (!stillBlocked) redirect("/panel");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
      <CloudOff className="size-7 text-subtle" aria-hidden />
      <h2 className="mt-3 font-semibold">{tk(`hosts.unavailable.${reason}.title`, { host: host.name })}</h2>
      <p className="mt-1.5 text-sm text-subtle">{tk(`hosts.unavailable.${reason}.body`, { host: host.name })}</p>
      {host.lastError && reason !== "unsupported" && (
        <p className="mt-3 font-mono text-xs text-danger">{host.lastError}</p>
      )}
      <p className="mt-4 text-xs text-subtle">{t("hosts.unavailable.hint")}</p>
    </div>
  );
}
