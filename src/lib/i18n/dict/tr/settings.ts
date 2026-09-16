/**
 * Ayarlar ekranı.
 *
 * `groups` artık şemanın DEĞİL sözlüğün işi: `settings.schema.ts` yalnızca
 * anahtarı ve yapıyı tutuyor, kategori adı ve açıklaması burada. Anahtarlar
 * şemadaki grup anahtarlarıyla birebir aynı olmak zorunda — eşleşmezse
 * kategori adı yerine anahtarın kendisi görünür.
 */

import { settingItems } from "./settings-items.ts";

export const settings = {
  /** Ayarların adları ve yardımları — şemadan üretildi, ayrı dosyada. */
  items: settingItems,

  /**
   * Kategori içindeki alt başlıklar. Anahtarlar `settings.schema.ts`teki
   * `section` alanlarıyla aynı; bildirim kanallarında kanal kimliğidir.
   */
  sections: {
    collection: "Toplama",
    retention: "Saklama süreleri",
    charts: "Grafikler",
    thresholds: "Eşikler",
    metering: "Ölçüm ve görünüm",
    restartLoop: "Restart-loop tespiti",
    actions: "Aksiyonlar",
    autoprune: "Otomatik disk temizliği",
    updates: "Güncelleme",
    imageUpdates: "Image güncellemesi",
    terminal: "Terminal",
    scanning: "Tarama",
    speedtest: "Hız testi",
    reverseProxy: "Reverse proxy",
    certificates: "Sertifika takibi",
    ddns: "DDNS",
    weather: "Hava durumu",
    internetIndicator: "İnternet göstergesi",
    kiosk: "Kiosk",
    addressResolution: "Adres çözümleme",
    serviceWidgets: "Servis widget'ları",
    cardDiscovery: "Otomatik kart keşfi",
    welcomePage: "Karşılama sayfası",
    temperature: "Sıcaklık",
    diskHealth: "Disk sağlığı ve RAID",
    capacityForecast: "Kapasite tahmini",
    notifyBehaviour: "Bildirim davranışı",
    quietHours: "Sessiz saatler",
    timeline: "Zaman çizelgesi",
    telegram: "Telegram",
    ha: "Home Assistant",
    ntfy: "ntfy",
    discord: "Discord",
    email: "E-posta",
    os: "İşletim sistemi",
    containerImages: "Container image'ları",
    backupTracking: "Yedek takibi",
    composeStacks: "Compose yığınları",
    containerFiles: "Container dosyaları",
    hostCron: "Host cron",
    hostConsole: "Sunucu konsolu",
    dbAdmin: "Veritabanı yöneticisi",
    access: "Erişim",
    diskAnalysis: "Disk analizi",
    backupEngine: "Yedekleme motoru",
    storage: "Saklama",
    vulnScan: "Açık taraması (M3.8)",
    portForward: "Port yönlendirme takibi (M3.8)",
    mqtt: "MQTT",
    prometheus: "Prometheus",
  },

  /** Kaydetmeden önceki doğrulama mesajları (`lib/settings/index.ts`). */
  validation: {
    number: "Sayı olmalı.",
    integer: "Tam sayı olmalı.",
    min: "En küçük değer {value}.",
    max: "En büyük değer {value}.",
    bool: "Doğru/yanlış olmalı.",
    enum: "Geçerli seçeneklerden biri olmalı.",
    cron: "5 alanlı cron ifadesi olmalı (dk sa gün ay hafta).",
    time: "Saat SS:DD biçiminde olmalı (ör. 23:00).",
    owner: "uid:gid biçiminde olmalı (ör. 1000:1000).",
    singleDir: "Tek bir klasör yolu olmalı.",
    absolutePath: "Yollar mutlak olmalı (/ ile başlamalı).",
    text: "Metin olmalı.",
    unknownKey: "Tanımsız ayar: {key}",
  },

  groups: {
    general: { label: "Genel", description: "Dil, tema, saat dilimi" },
    monitoring: {
      label: "İzleme & Saklama",
      description: "Metrik toplama sıklığı ve katman saklama süreleri (T1)",
    },
    health: {
      label: "Servis İzleme",
      description:
        "Health-check varsayılanları — her monitör kendi değerini tanımlayarak bunları ezebilir",
    },
    alerts: {
      label: "Alarm Eşikleri",
      description: "İzleme ekranında renk kodlaması, M1.3'ten itibaren bildirim tetikleyicisi",
    },
    docker: { label: "Docker", description: "Container ölçümü ve restart-loop tespiti" },
    hardware: {
      label: "Donanım",
      description: "Sıcaklık, S.M.A.R.T ve RAID/ZFS izleme eşikleri",
    },
    home: {
      label: "Ana Sayfa",
      description: "Hava durumu konumu, internet göstergesi ve kiosk görünümü",
    },
    network: {
      label: "Ağ",
      description: "Ağ taraması, cihaz envanteri ve Wake-on-LAN",
    },
    tailscale: {
      label: "Tailscale",
      description: "Tailnet durumu, peer listesi ve düğüm anahtarı bitiş takibi",
    },
    proxy: {
      label: "Proxy & DDNS",
      description: "Alan adı yayınlama, sertifika bitiş takibi ve dinamik DNS",
    },
    apps: {
      label: "Uygulamalar",
      description: "Kart adreslerinin çözümlenmesi ve Docker etiketlerinden otomatik kart keşfi",
    },
    notify: {
      label: "Bildirim Kanalları",
      description:
        "Her kanalın kendi seviye filtresi var — kritik olanı telefona, gerisini sadece panele düşürebilirsin",
    },
    updates: {
      label: "Güncelleme & Yedek",
      description:
        "Panel güncelleme KURMAZ, yalnızca haber verir — ne zaman kurulacağı senin kararın",
    },
    files: {
      label: "Dosyalar",
      description: "Dosya yöneticisinin erişebileceği kökler ve disk analizi sınırları",
    },
    logs: {
      label: "Loglar",
      description: "Container ve journald loglarının toplanması, saklanması ve budanması",
    },
    security: { label: "Güvenlik", description: "Oturum ömrü ve kaba kuvvet koruması" },
    api: {
      label: "Dış API",
      description:
        "Bearer token ile çalışan /api/v1 yüzeyi — script, Grafana, mobil uygulama ve n8n için",
    },
    integration: {
      label: "Dış Entegrasyon",
      description:
        "MQTT yayını ve Home Assistant keşfi — panelin verisi panelde kilitli kalmasın",
    },
    jobs: {
      label: "Panel İşleri",
      description: "Arka plan işlerinin çalışma sıklıkları — değişiklik anında uygulanır",
    },
  },

  tabs: {
    label: "Ayar kategorileri",
  },

  screen: {
    searchPlaceholder: "{group} içinde ara…",
    elsewhere: "Diğer kategorilerde:",
    noMatch: "{group} içinde “{query}” ile eşleşen ayar yok.",
    overridable: "ezilebilir",
    overridableTitle: "Kaynak bazında ezilebilir",
    restartRequired: "yeniden başlatma gerekir",
    seeded: "env'den tohumlandı",
    seededTitle: "İlk kurulumda env değişkeninden tohumlandı; artık panel otoriter",
    unreadable:
      "Kayıtlı bir değer var ama okunamıyor: MASTER_KEY, bu değer kaydedildiğindekinden farklı. Eski anahtar geri konabilir ya da değeri yeniden girebilirsin.",
    saved: "kaydedildi",
    resetTitle: "Varsayılana dön ({value})",
    containersEmpty: "Hiçbiri seçili değil — çalışan tüm container'lar toplanır.",
    notOverridable: "Bu ayar kaynak bazında ezilemez.",
  },
};

export type SettingsDict = typeof settings;
