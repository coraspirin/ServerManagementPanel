"use client";

import Link from "next/link";
import { Waypoints } from "lucide-react";
import {
  ForwardsPanel,
  IntrusionPanel,
  SshPanel,
  VulnPanel,
} from "@/components/security/SecurityMonitors";
import type { FailedLogin } from "@/lib/security/fail2ban";
import type { PortForward } from "@/lib/security/upnp";
import type { ScanRow } from "@/lib/security/vuln";
import { useT } from "@/lib/i18n/client";

/**
 * M3.7 / M3.8 — güvenlik izleyicileri.
 *
 * Dinleyen port envanteri M3.17'de `/ports`e taşındı (sahiplik çözümü ve boş
 * port bulucuyla büyüdü). Güvenlik duvarı (ufw) ekranı panelden kaldırıldı.
 * Geriye kalanlar (zafiyet, fail2ban, UPnP, SSH) tek ortak özelliği "pahalı
 * olduğu için kendi düğmesiyle yüklenen izleyici" olan panellerdir.
 */

export function SecurityScreen({
  initialScans,
  initialForwards,
  initialFailedLogins,
  canManage,
  remote = false,
}: {
  initialScans: ScanRow[];
  initialForwards: PortForward[];
  initialFailedLogins: FailedLogin[];
  canManage: boolean;
  /**
   * Uzak sunucu (çoklu sunucu): yalnızca SSH denetimi o sunucuda çalışıyor;
   * fail2ban, CVE ve UPnP yerel sunucuya özgü.
   */
  remote?: boolean;
}) {
  const t = useT();

  if (remote) {
    return (
      <div className="space-y-5">
        <p className="rounded-lg border border-dashed border-line px-5 py-3 text-sm text-subtle">
          {t("securityScreen.remoteNote")}
        </p>
        <section className="grid gap-3 sm:grid-cols-2">
          <NavCard
            href="/ports"
            title={t("securityScreen.ports")}
            description={t("securityScreen.portsDesc")}
            icon={<Waypoints className="size-4 text-subtle" aria-hidden />}
          />
        </section>
        <SshPanel />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2">
        <NavCard
          href="/ports"
          title={t("securityScreen.ports")}
          description={t("securityScreen.portsDesc")}
          icon={<Waypoints className="size-4 text-subtle" aria-hidden />}
        />
      </section>

      {/* --- M3.8: pahalı olanlar kendi düğmeleriyle yükleniyor --- */}
      <VulnPanel initial={initialScans} canManage={canManage} />
      <IntrusionPanel initialFailed={initialFailedLogins} canManage={canManage} />
      <ForwardsPanel initial={initialForwards} canManage={canManage} />
      <SshPanel />
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-line bg-surface px-5 py-4 transition-colors hover:border-brand"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-sm text-subtle">{description}</span>
    </Link>
  );
}
