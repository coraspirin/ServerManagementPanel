import { guardApi } from "@/lib/auth/api";
import { hasPermission } from "@/lib/auth/session";
import { appGroups } from "@/lib/apps/store";
import { listMonitors } from "@/lib/monitors/store";
import { getDockerProvider } from "@/lib/providers";

/**
 * M3.13 — komut paletinin arayabileceği canlı kayıtlar.
 *
 * Sayfalar `nav.ts`'ten geldiği için burada YOK: onlar istemcide zaten var ve
 * palet ağ isteği beklemeden açılabilmeli. Buradan yalnızca sunucuyu bilmeden
 * listelenemeyecek şeyler dönüyor — container'lar, uygulama kartları,
 * monitörler.
 *
 * Her kaynak KENDİ yetkisine göre süzülüyor: `docker.view` olmayan biri
 * palette container adı göremez. Palet bir kısayol, yetki atlama yolu değil.
 */
export const dynamic = "force-dynamic";

export type PaletteEntry = {
  id: string;
  label: string;
  hint: string;
  href: string;
  kind: "container" | "app" | "monitor";
  /** Dış adres mi — yeni sekmede açılmalı. */
  external: boolean;
};

export async function GET(request: Request) {
  const guard = await guardApi(request, "panel.view");
  if (!guard.ok) return guard.response;

  const user = guard.session.user;
  const entries: PaletteEntry[] = [];

  if (hasPermission(user, "docker.view")) {
    try {
      for (const container of await getDockerProvider().list(true)) {
        entries.push({
          id: `container:${container.id}`,
          label: container.name,
          hint: `${container.state} · ${container.image}`,
          href: "/docker",
          kind: "container",
          external: false,
        });
      }
    } catch {
      // Docker erişilemezse palet yine açılır, yalnızca container'sız.
      // Tek bir kaynağın düşmesi aramanın tamamını düşürmemeli.
    }
  }

  for (const group of appGroups("")) {
    for (const card of group.cards) {
      if (!card.enabled) continue;
      entries.push({
        id: `app:${card.id}`,
        label: card.name,
        hint: group.category?.name ?? "Uygulama",
        href: card.href,
        kind: "app",
        external: true,
      });
    }
  }

  if (hasPermission(user, "metrics.view")) {
    for (const monitor of listMonitors()) {
      entries.push({
        id: `monitor:${monitor.id}`,
        label: monitor.name,
        hint: `Servis · ${monitor.status}`,
        href: "/uptime",
        kind: "monitor",
        external: false,
      });
    }
  }

  return Response.json({ entries });
}
