/**
 * Arka plan işleri: adları, açıklamaları ve çalışma sonrası özet satırları.
 *
 * `detail` metinleri işin KENDİ çıktısı — Panel İşleri ekranında ve
 * `job_runs` geçmişinde görünüyor. Geçmişe yazılan satır, yazıldığı andaki
 * dilde kalır; sonradan çevrilmez (kayıt olduğu gibi durur).
 */

export const jobs = {
  items: {
    "metrics.collect": {
      label: "Metrik toplama",
      description: "CPU, bellek, disk ve ağ örneklerini kaydeder.",
    },
    "metrics.rollup": {
      label: "Metrik toplama & budama",
      description: "Ham metrikleri dakika/saat/gün katmanlarına toplar, süresi dolanı siler.",
    },
    "docker.collect": {
      label: "Container ölçümü",
      description: "Container CPU/bellek kullanımını ve yeniden başlatma sayacını kaydeder.",
    },
    "docker.autoprune": {
      label: "Docker otomatik temizlik",
      description: "Ayarlarda seçilen kapsamda kullanılmayan Docker kaynaklarını siler.",
    },
    "monitors.check": {
      label: "Servis kontrolü",
      description: "Zamanı gelen monitörleri yoklar ve durum değişimlerini kaydeder.",
    },
    "alerts.evaluate": {
      label: "Alarm değerlendirme",
      description: "Eşikleri ve servis durumlarını denetler, gereken bildirimleri gönderir.",
    },
    "updates.images": {
      label: "Image güncelleme kontrolü",
      description: "Container image'larının kayıt defterindeki sürümünü yereldekiyle karşılaştırır.",
    },
    "apps.discover": {
      label: "Kart keşfi",
      description:
        "Docker etiketlerinden uygulama kartı oluşturur, günceller ve etiketi kalkanları siler.",
    },
    "network.scan": {
      label: "Ağ taraması",
      description: "Alt ağdaki cihazları yoklar, envanteri günceller ve yeni cihazı bildirir.",
    },
    "network.oui": {
      label: "Üretici listesi güncelleme",
      description: "MAC adreslerini üreticiye çevirmek için kullanılan IEEE listesini tazeler.",
    },
    "network.speedtest": {
      label: "Hız testi",
      description: "İnternet bağlantısının indirme/yükleme hızını ölçer ve geçmişe kaydeder.",
    },
    "proxy.certificates": {
      label: "Sertifika kontrolü",
      description:
        "Yayınlanan alan adlarının sertifika bitiş tarihlerini okur ve yaklaşanı bildirir.",
    },
    "proxy.ddns": {
      label: "DDNS güncelleme",
      description: "Ev IP'si değiştiğinde dinamik DNS kayıtlarını günceller.",
    },
    "tailscale.keys": {
      label: "Tailscale anahtar kontrolü",
      description: "Düğüm anahtarı yakında dolacak cihazları bildirir.",
    },
    "events.prune": {
      label: "Olay kaydı budama",
      description: "Saklama süresini aşan olay kayıtlarını siler.",
    },
    "uptime.prune": {
      label: "Uptime budama",
      description: "Saklama süresini aşan servis durum kayıtlarını siler.",
    },
    "sessions.prune": {
      label: "Oturum temizliği",
      description: "Süresi dolmuş oturum kayıtlarını siler.",
    },
    "api.tokens_prune": {
      label: "API anahtarı budama",
      description: "İptal/süre dolumunun üzerinden saklama süresi geçmiş anahtarları siler.",
    },
    "security.vuln_scan": {
      label: "Güvenlik açığı taraması",
      description: "Çalışan container image'larını Trivy ile tarar (M3.8).",
    },
    "security.upnp_scan": {
      label: "Port yönlendirme kontrolü",
      description: "Router'daki UPnP yönlendirmelerini okur, yenileri bildirir (M3.8).",
    },
    "security.port_scan": {
      label: "Port haritası taraması",
      description: "Dinleyen portları ve sahiplerini tarar, sonucu önbelleğe yazar (M3.17).",
    },
    "backup.scheduler": {
      label: "Yedekleme zamanlayıcısı",
      description: "Vadesi gelen yedekleme işlerini çalıştırır (M3.4).",
    },
    "logs.collect": {
      label: "Log toplama",
      description: "Container ve journald loglarını arama indeksine yazar (M3.3).",
    },
    "logs.prune": {
      label: "Log budama",
      description: "Saklama süresini ve satır tavanını aşan log satırlarını siler.",
    },
    "mqtt.publish": {
      label: "MQTT yayını",
      description: "Panel metriklerini MQTT broker'ına basar (M3.11).",
    },
    "audit.prune": {
      label: "Audit budama",
      description: "Saklama süresini aşan audit kayıtlarını siler.",
    },
  },

  /** İçeride sabit tempolu işlerin sıklık metni (ayara bağlı olmayanlar). */
  schedule: {
    monitors: "sürekli (10 sn'de bir yoklama)",
    alerts: "sürekli (30 sn'de bir)",
  },

  /**
   * Durum rozetleri. Veritabanında Türkçe yazılı duruyorlar (eski kayıtlar);
   * ekran onları anahtara çevirip buradan okuyor.
   */
  status: {
    success: "başarılı",
    error: "hata",
    running: "çalışıyor",
    waiting: "bekliyor",
  },

  detail: {
    samples: "{count} örnek",
    dockerCollect: "{running}/{containers} çalışıyor · {written} ölçüm",
    autopruneOff: "otomatik temizlik kapalı",
    pruned: "{scope}: {removed} kaynak, {mb} MB",
    noMonitorsDue: "sırada monitör yok",
    monitors: "{checked} kontrol",
    monitorsChanged: "{checked} kontrol · değişim → {summary}",
    maintenance: "bakım",
    alertsNoChange: "{evaluated} koşul · değişiklik yok",
    alerts: "{evaluated} koşul · {events} olay · {notified} bildirim",
    alertsSuppressed: " · bastırılan {list}",
    images: "{count} container · {outdated} güncelleme var",
    imagesUnknown: " · {count} kontrol edilemedi",
    discoveryOff: "otomatik keşif kapalı",
    scanOff: "otomatik tarama kapalı",
    noSubnet: "alt ağ belirlenemedi",
    scan: "{subnet} · {scanned} adres · {alive} cihaz",
    scanNew: " · {count} yeni",
    speedtestOff: "otomatik hız testi kapalı",
    speedtest: "{down} Mbit indirme · {up} Mbit yükleme · {ping} ms",
    noDomains: "yayınlanan alan adı yok",
    certs: "{count} alan adı",
    certsExpiring: " · {count} bitiyor",
    certsUnreadable: " · {count} okunamadı",
    ddnsUpdated: "{count} güncellendi",
    ddnsUnchanged: "{count} değişmedi",
    ddnsFailed: "{count} hata",
    ddnsNone: "kayıt yok",
    tailscaleUnavailable: "tailscaled erişilemiyor",
    tailscaleNodes: "{count} düğüm",
    tailscaleExpiring: " · {count} anahtar bitiyor",
    eventsPruned: "{count} olay budandı",
    uptimePruned: "{count} kayıt budandı",
    sessionsPruned: "{count} oturum temizlendi",
    sessionsChallenges: ", {count} yarım giriş",
    tokensPruned: "{count} anahtar budandı",
    vulnPruned: " · {count} eski kayıt budandı",
    sockets: "{count} soket",
    logs: "{lines} satır / {sources} kaynak",
    logsMatched: "{count} desen eşleşti",
    logsSkipped: "atlanan: {list}",
    logsErrors: "hata: {list}",
    logsPrunedAge: "{count} satır yaşa göre",
    logsPrunedSize: ", {count} satır tavana göre",
    mqttOff: "MQTT kapalı",
    mqtt: "{count} konu yayınlandı",
    mqttDiscovery: " · {count} HA sensörü ilan edildi",
    auditPruned: "{count} kayıt budandı ({months} ay öncesi)",
  },

  announce: {
    newDeviceTitle: "Ağda yeni cihaz",
    newDeviceHint: "Tanıdığın bir cihazsa Ağ ekranından işaretleyebilirsin.",
    certTitle: "Sertifika bitiyor: {domain}",
    certExpired: "{domain} sertifikası {days} gün önce doldu.",
    certExpiring: "{domain} sertifikasının bitmesine {days} gün kaldı.",
    ipChangedTitle: "Genel IP değişti",
    tailscaleTitle: "Tailscale anahtarı bitiyor: {host}",
    tailscaleExpired: "{host} anahtarı doldu; cihaz tailnet'ten düşmüş olabilir.",
    tailscaleExpiring:
      "{host} düğüm anahtarının bitmesine {days} gün kaldı. Süresi dolan cihaz tailnet'ten sessizce düşer.",
  },

  runner: {
    unknownJob: "tanımsız iş",
    alreadyRunning: "iş zaten çalışıyor",
  },

  screen: {
    intro:
      "Zamanlamalar {settings} altından değiştirilir; değişiklik anında uygulanır, yeniden başlatma gerekmez.",
    introSettings: "Ayarlar → Panel İşleri",
    colJob: "İş",
    colSchedule: "Sıklık",
    colStatus: "Durum",
    colLastRun: "Son çalışma",
    colNext: "Sonraki",
    colRuns: "Çalışma/Hata",
    runNow: "Şimdi çalıştır",
    everySeconds: "her {value} sn",
    inSeconds: "{value} sonra",
    agoSeconds: "{value} önce",
  },
};

export type JobsDict = typeof jobs;
