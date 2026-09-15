import {
  Activity,
  Archive,
  Bell,
  CalendarClock,
  Container,
  Database,
  FileClock,
  Flame,
  FolderTree,
  HeartPulse,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Globe,
  Network,
  ScrollText,
  Send,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Thermometer,
  UsersRound,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import type { PermissionKey } from "@/lib/auth/types";
import { settingGroups } from "@/settings.schema";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Menüde görünmesi için gereken izin. */
  permission: PermissionKey;
  /** Ekran henüz yapılmadıysa hangi milestone getirecek. Yapıldığında kaldırılır. */
  milestone?: string;
  /** Alt maddeler — yalnızca üst madde etkinken açılır (bkz. Ayarlar). */
  children?: NavItem[];
};

/**
 * Ayar kategorilerinin menü ikonları.
 *
 * Şemada değil burada duruyorlar: `settings.schema.ts` job runner ve API
 * tarafından da içe aktarılıyor ve oraya `lucide-react` bağımlılığı sokmak,
 * sunucu tarafı bir modüle koca bir arayüz kütüphanesi taşımak olurdu.
 */
const SETTINGS_GROUP_ICONS: Record<string, LucideIcon> = {
  general: SlidersHorizontal,
  monitoring: Activity,
  health: HeartPulse,
  alerts: Bell,
  docker: Container,
  home: LayoutDashboard,
  network: Network,
  tailscale: Network,
  proxy: Globe,
  apps: LayoutGrid,
  hardware: Thermometer,
  notify: Send,
  updates: Archive,
  security: ShieldCheck,
  jobs: ListChecks,
  integration: Share2,
};

/** Kategoriler şemadan türetilir: yeni bir grup eklemek menüye de yansır. */
const settingsChildren: NavItem[] = settingGroups.map((group) => ({
  href: `/settings/${group.key}`,
  label: group.label,
  icon: SETTINGS_GROUP_ICONS[group.key] ?? Settings,
  permission: "settings.view",
}));

export type NavGroup = {
  title: string;
  items: NavItem[];
};

/**
 * Sol menü, PLAN.md'deki ekran haritasını izler. Bir milestone tamamlandığında
 * ilgili maddeden `milestone` alanı silinir ve yer tutucu sayfa gerçek ekranla
 * değiştirilir.
 */
export const navGroups: NavGroup[] = [
  {
    title: "Genel",
    items: [
      { href: "/panel", label: "Genel Bakış", icon: LayoutDashboard, permission: "panel.view" },
      { href: "/apps", label: "Uygulamalar", icon: LayoutGrid, permission: "panel.view" },
    ],
  },
  {
    title: "İzleme",
    items: [
      { href: "/monitoring", label: "İzleme", icon: Activity, permission: "metrics.view" },
      {
        href: "/uptime",
        label: "Servis Durumu",
        icon: HeartPulse,
        permission: "metrics.view",
      },
      { href: "/events", label: "Olaylar", icon: Bell, permission: "metrics.view" },
      { href: "/logs", label: "Loglar", icon: ScrollText, permission: "logs.view" },
    ],
  },
  {
    title: "Yönetim",
    items: [
      { href: "/docker", label: "Docker", icon: Container, permission: "docker.view" },
      { href: "/database", label: "Veritabanı", icon: Database, permission: "db.read" },
      { href: "/files", label: "Dosyalar", icon: FolderTree, permission: "files.read" },
      { href: "/backup", label: "Yedekleme", icon: Archive, permission: "backup.manage" },
    ],
  },
  {
    title: "Ağ & Güvenlik",
    items: [
      {
        href: "/proxy",
        label: "Proxy",
        icon: Globe,
        permission: "proxy.manage",
      },
      { href: "/network", label: "Ağ", icon: Network, permission: "network.manage" },
      {
        href: "/ports",
        label: "Port Haritası",
        icon: Waypoints,
        permission: "security.view",
      },
      {
        href: "/firewall",
        label: "Güvenlik Duvarı",
        icon: Flame,
        permission: "security.view",
      },
      { href: "/security", label: "Güvenlik", icon: ShieldCheck, permission: "security.view" },
    ],
  },
  {
    title: "Sistem",
    items: [
      { href: "/host", label: "Sunucu", icon: Server, permission: "host.service" },
      { href: "/users", label: "Kullanıcılar", icon: UsersRound, permission: "users.manage" },
      { href: "/audit", label: "Denetim Kayıtları", icon: FileClock, permission: "audit.view" },
      { href: "/jobs", label: "Panel İşleri", icon: ListChecks, permission: "settings.view" },
      {
        href: "/hostcron",
        label: "Host Görevleri",
        icon: CalendarClock,
        permission: "cron.manage",
      },
      {
        href: "/settings",
        label: "Ayarlar",
        icon: Settings,
        permission: "settings.view",
        children: settingsChildren,
      },
    ],
  },
];

/** Kullanıcının izinlerine göre menüyü süzer; boş kalan grupları atar. */
export function visibleNavGroups(permissions: PermissionKey[]): NavGroup[] {
  const filter = (items: NavItem[]): NavItem[] =>
    items
      .filter((item) => permissions.includes(item.permission))
      .map((item) =>
        item.children ? { ...item, children: filter(item.children) } : item,
      );

  return navGroups
    .map((group) => ({ ...group, items: filter(group.items) }))
    .filter((group) => group.items.length > 0);
}

/**
 * Bir yola karşılık gelen menü izi: üst madde varsa önce o, sonra alt madde.
 * Başlıkta "Ayarlar · Alarm Eşikleri" gösterebilmek için gerekiyor.
 */
export function findNavTrail(pathname: string): NavItem[] {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href === pathname) return [item];
      const child = item.children?.find((entry) => entry.href === pathname);
      if (child) return [item, child];
    }
  }
  return STANDALONE[pathname] ?? [];
}

/**
 * Menüde yeri olmayan ama başlığı olması gereken ekranlar. "Hesabım" sol
 * menüye konmadı: herkeste görünen, günde bir kez girilen bir sayfanın
 * dokuz kalemlik menüde yer kaplaması doğru değil — üst bardaki adın kendisi
 * bağlantı.
 */
const STANDALONE: Record<string, NavItem[]> = {
  "/hesap": [
    { href: "/hesap", label: "Hesabım", icon: UsersRound, permission: "panel.view" },
  ],
};
