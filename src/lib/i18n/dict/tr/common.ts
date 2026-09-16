/**
 * Ortak metinler — TÜRKÇE, ve tüm sözlüğün kaynağı.
 *
 * Buradaki yapı İngilizce dosyanın TİPİ: `dict/en/common.ts` bu tipe göre
 * yazılıyor, eksik ya da fazla anahtar `npm run typecheck` ile patlıyor.
 *
 * Yalnızca birden çok ekranda geçen metinler burada durur. Bir ekrana özel
 * metin kendi ad alanı dosyasına yazılır.
 */

export const common = {
  appName: "Sunucu Yönetim Paneli",
  appDescription: "Ev sunucusu için izleme, Docker/sistem yönetimi ve otomasyon paneli",

  /** Kategorisi olmayan kartların başlığı — kiosk ve uygulamalar ekranı. */
  uncategorized: "Diğer",

  /** Uzun süre birimleri — `formatDuration`. */
  duration: {
    day: { one: "{count} gün", other: "{count} gün" },
    hour: { one: "{count} saat", other: "{count} saat" },
    minute: { one: "{count} dk", other: "{count} dk" },
    second: { one: "{count} sn", other: "{count} sn" },
  },

  /** Kısa süre birimleri — `formatUptime`. */
  durationShort: {
    day: { one: "{count} g", other: "{count} g" },
    hour: { one: "{count} sa", other: "{count} sa" },
    minute: { one: "{count} dk", other: "{count} dk" },
    second: { one: "{count} sn", other: "{count} sn" },
  },

  /** Geçmiş zaman — `formatRelative`. */
  relative: {
    now: "az önce",
    minutes: { one: "{count} dk önce", other: "{count} dk önce" },
    hours: { one: "{count} sa önce", other: "{count} sa önce" },
    days: { one: "{count} gün önce", other: "{count} gün önce" },
  },

  actions: {
    save: "Kaydet",
    cancel: "Vazgeç",
    delete: "Sil",
    edit: "Düzenle",
    add: "Ekle",
    close: "Kapat",
    refresh: "Yenile",
    retry: "Yeniden dene",
    confirm: "Onayla",
    search: "Ara",
    copy: "Kopyala",
    copied: "Kopyalandı",
    details: "Ayrıntılar",
    back: "Geri",
  },

  states: {
    loading: "Yükleniyor…",
    saving: "Kaydediliyor…",
    saved: "Kaydedildi",
    empty: "Kayıt yok",
    none: "Yok",
    unknown: "Bilinmiyor",
    yes: "Evet",
    no: "Hayır",
    on: "Açık",
    off: "Kapalı",
  },

  errors: {
    generic: "Bir şeyler ters gitti.",
    network: "Sunucuya ulaşılamadı.",
    notSaved: "Kaydedilemedi.",
  },
};

/**
 * İngilizce dosyanın uyacağı tip.
 *
 * `as const` BİLEREK yok: sabitlense tip metnin kendisi olurdu ve İngilizce
 * dosya `save: "Kaydet"` yazmaya zorlanırdı. Böyle yazıldığında TypeScript
 * değerleri `string` olarak çıkarıyor — yapı sabit, metin serbest.
 */
export type CommonDict = typeof common;
