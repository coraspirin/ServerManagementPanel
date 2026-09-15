import type { PermissionKey } from "@/lib/auth/types";

export type SettingType =
  | "int"
  | "float"
  | "bool"
  | "string"
  | "enum"
  | "cron"
  /** "HH:MM" — gün içi saat. Sessiz saatler gibi ayarlarda kullanılır. */
  | "time"
  | "secret"
  /*
    M3.45 — çalışma zamanı verisinden beslenen alanlar.

    `enum` bunları karşılayamıyor: onun seçenekleri şemada SABİT. Buradakiler
    ise sunucunun o anki durumundan geliyor (hangi container'lar var, host'ta
    hangi kullanıcılar tanımlı, diskte hangi klasörler duruyor). Hepsinin
    DEPOLAMA biçimi hâlâ metin — yalnızca giriş yolu değişiyor, dolayısıyla
    okuyan kod (`allowedRoots`, `logs.sources` ayrıştırması, `caddy.ts`)
    hiç değişmiyor.
  */
  /** Tek container adı; liste `/api/docker`den. */
  | "container"
  /** Virgülle ayrılmış container adları; onay kutusu listesi. */
  | "containers"
  /** Tek mutlak klasör yolu; host klasör gezgininden seçilir. */
  | "dir"
  /** Virgülle ayrılmış mutlak klasör yolları. */
  | "dirs"
  /** "uid:gid" — host kullanıcı/grup listesinden seçilir. */
  | "owner"
  /** Sınırlı HTML alt kümesi; popup'ta zengin metin kutusuyla yazılır. */
  | "richtext";

export type SettingScope = "global" | "host" | "container" | "volume" | "app" | "repo";

export type SettingDef = {
  key: string;
  group: string;
  /**
   * Kategori içindeki alt başlık. Boş bırakılırsa ayar, başlıksız ilk bloğa
   * düşer — beş ayarlık bir kategoriyi zorla bölmek gerekmez.
   */
  section?: string;
  type: SettingType;
  default: string | number | boolean;
  label: string;
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** Kaynak bazında ezilebilir mi (⭐ işaretli ayarlar). */
  overridable?: boolean;
  /** Değişiklik yürürlüğe girmesi için yeniden başlatma gerekiyor mu. */
  restartRequired?: boolean;
  /** İlk kurulumda bu env değişkeninden tohumlanır (T9). */
  envVar?: string;
  /** Görmek/değiştirmek için gereken izin (varsayılan settings.view/edit). */
  viewPermission?: PermissionKey;
};

/**
 * Bir ayar kategorisi. `key` aynı zamanda URL parçasıdır (`/settings/<key>`),
 * bu yüzden yeni bir kategori eklemek yeni bir sayfa açar — ayrıca route
 * yazmak gerekmez.
 */
export type SettingGroupDef = {
  key: string;
  label: string;
  description?: string;
};

export type ResolvedSetting = {
  key: string;
  value: string | number | boolean;
  /** Değer nereden geldi: şema varsayılanı mı, ezme mi. */
  source: "default" | "global" | "scope";
  isSecret: boolean;
  /** Secret ise değer maskelenir; yalnızca tanımlı olup olmadığı bildirilir. */
  hasValue?: boolean;
  /**
   * Kayıtlı bir secret var ama MASTER_KEY değiştiği için çözülemiyor.
   * "Tanımlı değil" ile karıştırılmamalı — kullanıcı değeri girmişti.
   */
  unreadable?: boolean;
};
