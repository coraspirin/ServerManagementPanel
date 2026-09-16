"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, Search, Server, UserRound, X } from "lucide-react";
import { findNavTrail, visibleNavGroups } from "@/lib/nav";
import type { NavItem } from "@/lib/nav";
import type { PermissionKey } from "@/lib/auth/types";
import { useDynamicT, useT } from "@/lib/i18n/client";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { CommandPalette } from "./CommandPalette";
import { LinkPending } from "./LinkPending";
import { PageHelp } from "./PageHelp";
import { ThemeToggle } from "./ThemeToggle";

type Props = {
  children: React.ReactNode;
  mode: "mock" | "live";
  version: string;
  user: { displayName: string; roleName: string; permissions: PermissionKey[] };
};

export function AppShell({ children, mode, version, user }: Props) {
  const t = useT();
  // Menü maddelerinin anahtarı şemadan türeyebiliyor (ayar kategorileri), bu
  // yüzden sabit anahtar bekleyen `t` yerine dinamik olanı.
  const tk = useDynamicT();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const trail = findNavTrail(pathname);
  const groups = visibleNavGroups(user.permissions);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // Adres değişince çekmece kapanır. Bağlantıların kendi `onNavigate`'i zaten
  // bunu yapıyor; buradaki kural geri/ileri düğmesi ve palet gibi bağlantı
  // dışı gezinmeleri de kapsıyor. Efekt değil, render sırasında düzeltme:
  // efektle yapılsaydı çekmece bir kare açık kalır ve React zincirleme
  // render uyarısı verirdi.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  // Çekmece açıkken arkadaki sayfa kaymasın: telefonda perdeye dokunup
  // kaydırınca listenin altındaki içeriğin sürüklenmesi, kapatma niyetini
  // sessizce yutan bir davranış.
  //
  // Kilit `<body>`ye değil `<html>`e uygulanıyor. `body`ye `overflow: hidden`
  // vermek onu yeni bir kaydırma kabına çevirir; yapışkan üstbarın dayandığı
  // kaydırma kabı da bir anda o olur ve kabın kendi kaydırması sıfır olduğu
  // için başlık statik yerine (yani ekranın epey yukarısına) fırlar — sayfayı
  // aşağı kaydırıp menüyü açınca üstbar gözden kaybolurdu. Kaydıran öğe zaten
  // `<html>`, kilidi orada tutunca kaydırma konumu ve üstbar yerinde kalıyor.
  useEffect(() => {
    if (!menuOpen || isDesktop) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [menuOpen, isDesktop]);

  // Esc ile kapatma — çekmece `<dialog>` olmadığı için bedava gelmiyor.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh">
      {menuOpen && (
        <button
          type="button"
          aria-label={t("shell.menu.close")}
          onClick={() => setMenuOpen(false)}
          className="tap-auto fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      {/*
        Çekmece kapalıyken ekranın dışında ama hâlâ belgede: `inert` olmazsa
        sekme tuşu ve ekran okuyucu görünmeyen 23 bağlantıda dolaşır. Masaüstünde
        aynı öğe sabit sütun olduğu için `inert` yalnızca dar ekranda veriliyor.

        Konumlandırma iki ayrı düzen: dar ekranda `fixed` çekmece, `lg` üstünde
        akışta duran ama tepeye yapışan sütun. `lg:h-dvh` + `lg:self-start`
        ikisi birden gerekli — flex satırında öğe varsayılan `stretch` ile
        sayfanın tamamı kadar uzar ve uzayınca sticky'nin yapışacak boşluğu
        kalmaz. `inset-y-0` yerine ayrı `top-0 bottom-0` yazılmasının sebebi
        de bu: `lg:bottom-auto` ile alt sabitlemeyi açıkça kaldırmak, Tailwind'in
        kısayol/uzun yazım sıralamasına bel bağlamaktan daha güvenli.
      */}
      <aside
        inert={!isDesktop && !menuOpen}
        className={`fixed bottom-0 left-0 top-0 z-40 flex w-64 max-w-[80vw] shrink-0 flex-col border-r border-line bg-surface pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] transition-transform lg:sticky lg:bottom-auto lg:left-auto lg:h-dvh lg:max-w-none lg:translate-x-0 lg:self-start ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <Server className="size-5 shrink-0 text-brand" aria-hidden />
          <span className="truncate font-semibold tracking-tight">{t("shell.brand")}</span>
          <button
            type="button"
            aria-label={t("shell.menu.close")}
            onClick={() => setMenuOpen(false)}
            className="-mr-1 ml-auto flex shrink-0 items-center justify-center rounded p-1 text-subtle hover:text-ink lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {groups.map((group) => (
            <div key={group.titleKey} className="mb-5">
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                {tk(group.titleKey)}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  // Alt maddeler yalnızca o bölümdeyken açılır: menü sürekli
                  // dokuz ayar kategorisiyle şişmesin.
                  const inSection =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const children = item.children ?? [];

                  return (
                    <li key={item.href}>
                      <NavLink
                        item={item}
                        active={pathname === item.href || (inSection && children.length === 0)}
                        onNavigate={() => setMenuOpen(false)}
                      />

                      {inSection && children.length > 0 && (
                        <ul className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-line pl-2">
                          {children.map((child) => (
                            <li key={child.href}>
                              <NavLink
                                item={child}
                                active={pathname === child.href}
                                onNavigate={() => setMenuOpen(false)}
                                compact
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/*
          Hesap bağlantısı başlıkta `sm` altında gizli — telefonda parola ve
          iki adımlı doğrulama sayfasına başka hiçbir kapı kalmıyordu. O yüzden
          burada yalnız dar ekranda beliriyor; ikisi aynı anda görünmüyor.
        */}
        <Link
          href="/hesap"
          className="flex shrink-0 items-center gap-2.5 border-t border-line px-4 py-3 transition-colors hover:bg-line/50 sm:hidden"
        >
          <UserRound className="size-4 shrink-0 text-subtle" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium leading-tight">
              {user.displayName}
            </span>
            <span className="block truncate text-xs leading-tight text-subtle">
              {user.roleName}
            </span>
          </span>
        </Link>

        <div className="shrink-0 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-xs text-subtle">
          <div className="flex items-center justify-between">
            <span className="font-mono">v{version}</span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                mode === "mock" ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"
              }`}
              title={mode === "mock" ? t("shell.mode.mockTitle") : t("shell.mode.liveTitle")}
            >
              {mode === "mock" ? t("shell.mode.mock") : t("shell.mode.live")}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Yapışkan üstbar. Kaydırma modeli değişmiyor — sayfa yine belge
          seviyesinde kayıyor, üstbar sadece kendi sütununun tepesine
          yapışıyor. `bg-surface`in opak olması şart: yarı saydam olsaydı
          altından geçen içerik başlığın içinden okunurdu. `z-20`, perde
          (z-30), çekmece (z-40) ve komut paletinin (z-50) altında kalıyor.
        */}
        <header className="sticky top-0 z-20 flex h-[var(--header-h)] shrink-0 items-center gap-2 border-b border-line bg-surface pl-4 pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] sm:gap-3">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label={t("shell.menu.open")}
            onClick={() => setMenuOpen(true)}
            className="-ml-1 flex shrink-0 items-center justify-center rounded p-1 text-subtle hover:text-ink lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          {/*
            Tema düğmesi üstbarın SOL ucunda (M3.46): sağ taraf zaten arama,
            hesap ve çıkışla dolu ve günde bir kez basılan bir düğmeyi oraya
            koymak, günde on kez basılanların arasına sıkıştırmak olurdu.
          */}
          <ThemeToggle />

          <h1 className="flex min-w-0 items-baseline gap-1.5 font-semibold">
            {trail.length === 0 ? (
              t("shell.brand")
            ) : (
              trail.map((item, index) => (
                <span key={item.href} className="flex min-w-0 items-baseline gap-1.5">
                  {index > 0 && (
                    <span className="text-subtle" aria-hidden>
                      ·
                    </span>
                  )}
                  <span
                    className={`truncate ${
                      index < trail.length - 1 ? "font-normal text-subtle" : ""
                    }`}
                  >
                    {tk(item.labelKey)}
                  </span>
                </span>
              ))
            )}
          </h1>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            {/*
              Yardım başlığın hemen yanında: "bu ekran ne işe yarıyor" sorusu
              ekranın içinde değil, ekranı tanımadan sorulur.
            */}
            <PageHelp />

            {/*
              Paletin kendi kısayolu var ama görünür bir düğmesi de olmalı:
              keşfedilmeyen bir kısayol yok sayılır. Düğme paleti kendi
              dinlediği olayla açıyor — iki ayrı açma yolu tutmak, ikisinin
              zamanla ayrışmasına davetiye olurdu.
            */}
            <button
              type="button"
              title={t("shell.search.title")}
              onClick={() =>
                window.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
                )
              }
              aria-label={t("shell.search.label")}
              className="flex items-center justify-center gap-2 rounded-md border border-line px-2 py-1.5 text-subtle transition-colors hover:text-ink"
            >
              <Search className="size-4" />
              <kbd className="hidden font-mono text-[10px] sm:block">Ctrl K</kbd>
            </button>
            <Link
              href="/hesap"
              title={t("shell.account.title")}
              className="hidden rounded-md px-2 py-1 text-right transition-colors hover:bg-line/50 sm:block"
            >
              <div className="text-sm font-medium leading-tight">{user.displayName}</div>
              <div className="text-xs leading-tight text-subtle">{user.roleName}</div>
            </Link>
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              title={t("shell.logout")}
              aria-label={t("shell.logout")}
              className="flex items-center justify-center rounded-md border border-line p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-50"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        <main className="pad-main min-w-0 flex-1">{children}</main>
      </div>

      <CommandPalette permissions={user.permissions} />
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
  compact,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const tk = useDynamicT();

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2 transition-colors ${
        compact ? "py-1 text-[13px]" : "py-1.5 text-sm"
      } ${
        active
          ? "bg-brand/10 font-medium text-brand"
          : "text-subtle hover:bg-line/50 hover:text-ink"
      }`}
    >
      <Icon className={`shrink-0 ${compact ? "size-3.5" : "size-4"}`} aria-hidden />
      <span className="truncate">{tk(item.labelKey)}</span>
      {item.milestone && (
        <span className="ml-auto rounded border border-line px-1 py-px font-mono text-[10px] text-subtle">
          {item.milestone}
        </span>
      )}
      {/*
        Tıklanan maddenin kendisinde bekleme göstergesi (M3.45). `ml-auto`
        yalnızca kilometre taşı rozeti yokken veriliyor — ikisi birden sağa
        yaslanınca rozet satırın ortasında kalıyordu.
      */}
      <LinkPending className={item.milestone ? "" : "ml-auto"} />
    </Link>
  );
}
