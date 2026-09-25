import { enterHost } from "@/lib/hosts/context";
import { pageHostId } from "@/lib/hosts/request";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { dockerOverview } from "@/lib/docker/view";
import { getBool, getNumber, getString } from "@/lib/settings";
import { DockerScreen } from "./DockerScreen";

export const dynamic = "force-dynamic";

/** Container tablosu (M1.6). Aksiyonlar ve canlı log M1.7'de eklenecek. */
export default async function DockerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requirePermission("docker.view");
  enterHost(await pageHostId({ agent: true }));

  /*
    `?tab=` (M3.37): `/appstore` yönlendirmesi ve volume satırındaki yığın
    bağlantısı buradan geliyor. Geçersiz bir değer sessizce yok sayılıyor —
    elle yazılmış bir adres yüzünden boş bir ekran açmak yerine Container
    sekmesi açılıyor.
  */
  const tab = (await searchParams).tab ?? "";

  return (
    <DockerScreen
      initialTab={tab}
      initial={await dockerOverview()}
      showStoppedDefault={getBool("docker.show_stopped")}
      refreshSeconds={getNumber("general.ui_refresh_interval")}
      logTailLines={getNumber("docker.log_tail_lines")}
      publicHost={getString("docker.public_host").trim()}
      canAct={hasPermission(session.user, "docker.action")}
      canExec={hasPermission(session.user, "docker.exec")}
      canInstall={hasPermission(session.user, "apps.install")}
      canService={hasPermission(session.user, "host.service")}
    />
  );
}
