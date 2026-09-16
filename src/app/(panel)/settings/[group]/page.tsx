import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/session";
import { resolveAll, seededKeys } from "@/lib/settings";
import { defsOfGroup, findSettingGroup, sectionsOfGroup } from "@/settings.schema";
import { availableLocales } from "@/locales";
import { SettingsScreen } from "../SettingsScreen";
import { SettingsTabs } from "../SettingsTabs";

export const dynamic = "force-dynamic";

/**
 * Tek bir ayar kategorisi. Route parçası doğrudan şemadaki grup anahtarıdır,
 * bu yüzden şemaya yeni bir kategori eklemek yeni bir sayfa da açar.
 */
export default async function SettingsGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("settings.view");
  const group = findSettingGroup((await params).group);
  if (!group) notFound();

  const seeded = seededKeys();
  const defs = defsOfGroup(group.key).map((def) => ({
    ...def,
    seededFromEnv: seeded.has(def.key),
  }));

  return (
    <div className="space-y-4">
      {/*
        Sekme çubuğu (M3.42): kategoriler menüdeki açılır listede vardı ama
        sayfada yoktu; 19 kategori arasında dolaşmak her seferinde menüyü
        açmayı gerektiriyordu.
      */}
      <SettingsTabs active={group.key} />

      {/*
        `key`: kategori değişince ekran yeniden kurulur, aksi halde önceki
        kategorinin arama metni ve yarım kalan taslak değerleri taşınırdı.
      */}
      <SettingsScreen
        key={group.key}
        group={group}
        sections={sectionsOfGroup(defs)}
        initialValues={resolveAll()}
        canEdit={hasPermission(session.user, "settings.edit")}
        initialQuery={(await searchParams).q ?? ""}
        locales={availableLocales()}
      />
    </div>
  );
}
