/**
 * Alarm başlıkları ve açıklamaları.
 *
 * Bu metinler olay kaydına YAZILIYOR ve bildirim kanallarına gidiyor; yazıldığı
 * andaki dilde kalırlar. Dil değiştirildiğinde eski kayıtlar çevrilmez — kayıt
 * olduğu gibi durur, sonradan değiştirilmesi doğru olmazdı.
 */

export const alerts = {
  cpu: {
    ok: "İşlemci yükü normale döndü",
    high: "İşlemci yükü yüksek ({value})",
    detail: "Son 5 dakikanın ortalaması {value}. Uyarı eşiği {warn}, kritik eşik {crit}.",
  },

  ram: {
    ok: "Bellek kullanımı normale döndü",
    high: "Bellek kullanımı yüksek ({value})",
    detail: "Kullanım {value}{used}.",
  },

  disk: {
    ok: "{mount} doluluğu normale döndü",
    high: "{mount} doluyor ({value})",
    detail: "{used} / {total} kullanımda, {free} boş.",
  },

  monitor: {
    down: "{name} yanıt vermiyor",
    up: "{name} yeniden çalışıyor",
    downDetail: "{target} — {error}",
    upDetail: "{target} — {latency} ms",
    noResponse: "yanıt yok",
  },

  temp: {
    ok: "{source} {label} sıcaklığı normale döndü",
    high: "{source} {label} sıcak ({value} °C)",
    detail: "Ölçüm {value} °C. Uyarı {warn} °C, kritik {crit} °C{sensor}.",
    sensorOwn: " (sensörün kendi eşikleri)",
  },

  smart: {
    failed: "{device} S.M.A.R.T arızası bildiriyor",
    bad: "{device} disk hatası biriktiriyor",
    ok: "{device} sağlık durumu normale döndü",
    detail: "{model} — durum {health}. {counters}",
    reallocated: "yeniden atanan sektör: {count}",
    pending: "bekleyen sektör: {count}",
    uncorrectable: "düzeltilemeyen: {count}",
  },

  pool: {
    degraded: "{name} havuzu bozulmuş ({state})",
    scrubOverdue: "{name} havuzu uzun süredir doğrulanmadı",
    ok: "{name} havuzu normale döndü",
    detail: "{kind} · durum {state} · {detail}",
    lastScrub: " · son scrub {days} gün önce",
  },

  report: {
    stale: "Donanım raporu güncellenmiyor",
    ok: "Donanım raporu yeniden güncelleniyor",
    never: "Host'taki scripts/hardware.sh hiç çalışmamış görünüyor.",
    detail: "Son rapor {minutes} dakika önce üretildi.",
  },

  capacity: {
    ok: "{label} dolma eğilimi geçti",
    filling: "{label} yaklaşık {days} gün sonra dolabilir",
    detail:
      "Şu an {current}, günde {slope} puan artıyor. {basedOn} günlük veriye dayanan tahmin, uyum {confidence}.",
  },

  restartLoop: {
    title: "{container} sürekli yeniden başlıyor",
    detail:
      "Son {minutes} dakikada {count} kez yeniden başladı. Container listede “çalışıyor” görünse bile hizmet vermiyor olabilir; loglara bakmak gerekir.",
  },

  osUpdate: {
    staleTitle: "İşletim sistemi güncelleme raporu eskidi",
    staleDetail:
      "Host'taki os-updates.sh {hours} saatten uzun süredir çalışmadı. Liste eski olabilir — cron kaydı duruyor mu?",
    freshTitle: "Güncelleme raporu güncel",
    freshDetail: "os-updates.sh zamanında çalışıyor.",
    securityLabel: "güvenlik güncellemesi",
    packageLabel: "paket güncellemesi",
    pendingTitle: "{count} {label} bekliyor",
    upToDateTitle: "İşletim sistemi güncel",
    noneDetail: "Bekleyen güncelleme yok.",
    rebootSuffix: "\nSunucu yeniden başlatma bekliyor.",
  },

  backup: {
    unreadableTitle: "Yedek klasörü okunamıyor",
    noneTitle: "Yedek klasöründe hiç yedek yok",
    staleTitle: "Yedek eskidi",
    freshTitle: "Yedekler güncel",
    emptyDetail: "{dir} boş. Yedekleme çalışıyor mu?",
    detail: "En son yedek: {name} — {hours} saat önce (eşik {threshold} saat).",
  },

  imageUpdate: {
    available: "{count} container için yeni image sürümü var",
    upToDate: "Tüm image'lar güncel",
    noneDetail: "Kayıt defterindeki sürümler yereldekiyle aynı.",
  },
};

export type AlertsDict = typeof alerts;
