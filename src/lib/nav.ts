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
  /**
   * Sözlük anahtarı — metnin kendisi DEĞİL (`nav.items.docker` gibi).
   *
   * Tip `string`, çünkü ayar kategorilerinin anahtarı şemadan türeyip çalışma
   * zamanında oluşuyor; derleme anında bilinen bir birleşim yazılamıyor.
   * Karşılığı olmayan anahtar menüde anahtarın kendisi olarak görünür.
   */
  labelKey: string;
  icon: LucideIcon;
  /** Menüde görünmesi için gereken izin. */
  permission: PermissionKey;
  /** Ekran henüz yapılmadıysa hangi milestone getirecek. Yapıldığında kaldırılır. */
  milestone?: string;
  /** Alt maddeler — yalnızca üst madde etkinken açılır (bkz. Ayarlar). */
  children?: NavItem[];
  /**
   * Çoklu sunucu: ekran yalnızca panelin kendi sunucusunda çalışıyor (ufw,
   * LAN taraması, host cron...). Uzak sunucu seçiliyken menüde gizlenir.
   */
  localOnly?: boolean;
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
  labelKey: `settings.groups.${group.key}.label`,
  icon: SETTINGS_GROUP_ICONS[group.key] ?? Settings,
  permission: "settings.view",
}));

export type NavGroup = {
  titleKey: string;
  items: NavItem[];
};

/**
 * Sol menü, PLAN.md'deki ekran haritasını izler. Bir milestone tamamlandığında
 * ilgili maddeden `milestone` alanı silinir ve yer tutucu sayfa gerçek ekranla
 * değiştirilir.
 */
export const navGroups: NavGroup[] = [
  {
    titleKey: "nav.groups.general",
    items: [
      { href: "/panel", labelKey: "nav.items.overview", icon: LayoutDashboard, permission: "panel.view" },
      { href: "/apps", labelKey: "nav.items.apps", icon: LayoutGrid, permission: "panel.view" },
    ],
  },
  {
    titleKey: "nav.groups.monitoring",
    items: [
      { href: "/monitoring", labelKey: "nav.items.monitoring", icon: Activity, permission: "metrics.view" },
      {
        href: "/uptime",
        labelKey: "nav.items.uptime",
        icon: HeartPulse,
        permission: "metrics.view",
      },
      { href: "/events", labelKey: "nav.items.events", icon: Bell, permission: "metrics.view" },
      { href: "/logs", labelKey: "nav.items.logs", icon: ScrollText, permission: "logs.view" },
    ],
  },
  {
    titleKey: "nav.groups.management",
    items: [
      { href: "/docker", labelKey: "nav.items.docker", icon: Container, permission: "docker.view" },
      { href: "/database", labelKey: "nav.items.database", icon: Database, permission: "db.read" },
      { href: "/files", labelKey: "nav.items.files", icon: FolderTree, permission: "files.read" },
      { href: "/backup", labelKey: "nav.items.backup", icon: Archive, permission: "backup.manage" },
    ],
  },
  {
    titleKey: "nav.groups.networkSecurity",
    items: [
      {
        href: "/proxy",
        labelKey: "nav.items.proxy",
        icon: Globe,
        permission: "proxy.manage",
      },
      {
        href: "/network",
        labelKey: "nav.items.network",
        icon: Network,
        permission: "network.manage",
        localOnly: true,
      },
      {
        href: "/ports",
        labelKey: "nav.items.ports",
        icon: Waypoints,
        permission: "security.view",
      },
      {
        href: "/firewall",
        labelKey: "nav.items.firewall",
        icon: Flame,
        permission: "security.view",
        localOnly: true,
      },
      {
        href: "/security",
        labelKey: "nav.items.security",
        icon: ShieldCheck,
        permission: "security.view",
        localOnly: true,
      },
    ],
  },
  {
    titleKey: "nav.groups.system",
    items: [
      { href: "/hosts", labelKey: "nav.items.hosts", icon: Server, permission: "hosts.view" },
      { href: "/host", labelKey: "nav.items.host", icon: Server, permission: "host.service" },
      { href: "/users", labelKey: "nav.items.users", icon: UsersRound, permission: "users.manage" },
      { href: "/audit", labelKey: "nav.items.audit", icon: FileClock, permission: "audit.view" },
      { href: "/jobs", labelKey: "nav.items.jobs", icon: ListChecks, permission: "settings.view" },
      {
        href: "/hostcron",
        labelKey: "nav.items.hostcron",
        icon: CalendarClock,
        permission: "cron.manage",
        localOnly: true,
      },
      {
        href: "/settings",
        labelKey: "nav.items.settings",
        icon: Settings,
        permission: "settings.view",
        children: settingsChildren,
      },
    ],
  },
];

/** Kullanıcının izinlerine göre menüyü süzer; boş kalan grupları atar. */
export function visibleNavGroups(
  permissions: PermissionKey[],
  options: { remoteHost?: boolean } = {},
): NavGroup[] {
  const filter = (items: NavItem[]): NavItem[] =>
    items
      .filter((item) => permissions.includes(item.permission))
      .filter((item) => !(options.remoteHost && item.localOnly))
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
  "/hosts/unavailable": [
    { href: "/hosts", labelKey: "nav.items.hosts", icon: Server, permission: "hosts.view" },
  ],
  "/hesap": [
    { href: "/hesap", labelKey: "nav.items.account", icon: UsersRound, permission: "panel.view" },
  ],
};
