/**
 * Metrik adları, aralık düğmeleri, çözünürlük katmanları ve İzleme ekranı.
 *
 * `labels` anahtarları metrik kimlikleriyle birebir aynı ("cpu.pct"); grafik
 * göstergeleri ve API yanıtları aynı listeden besleniyor.
 */

export const metrics = {
  labels: {
    "cpu.pct": "İşlemci",
    "cpu.iowait_pct": "G/Ç bekleme",
    "mem.used_pct": "Bellek",
    "mem.used": "Kullanılan bellek",
    "mem.total": "Toplam bellek",
    "swap.used_pct": "Takas alanı",
    "swap.used": "Kullanılan takas",
    "load.1m": "Yük (1 dk)",
    "load.5m": "Yük (5 dk)",
    "load.15m": "Yük (15 dk)",
    "uptime.seconds": "Çalışma süresi",
    "disk.used_pct": "Disk doluluğu",
    "disk.used": "Kullanılan disk",
    "disk.free": "Boş disk",
    "disk.total": "Disk kapasitesi",
    "net.rx_bps": "İndirme",
    "net.tx_bps": "Yükleme",
    "monitor.latency": "Yanıt süresi",
    "docker.cpu_pct": "Container CPU",
    "docker.mem_used": "Container bellek",
    "docker.mem_pct": "Container bellek",
    "docker.net_rx": "Container ağ giriş",
    "docker.net_tx": "Container ağ çıkış",
    "docker.blk_read": "Container disk okuma",
    "docker.blk_write": "Container disk yazma",
    "docker.restart_count": "Yeniden başlatma",
    "docker.running": "Çalışıyor",
  },

  ranges: {
    "1h": "1 saat",
    "6h": "6 saat",
    "24h": "24 saat",
    "7d": "7 gün",
    "30d": "30 gün",
    "1y": "1 yıl",
  },

  /** Grafiğin hangi katmandan çizildiği — ham veri mi, toplanmış ortalama mı. */
  tiers: {
    raw: "ham",
    minute: "1 dakikalık ortalama",
    hour: "1 saatlik ortalama",
    day: "günlük ortalama",
  },

  value: {
    seconds: "{value} sn",
    milliseconds: "{value} ms",
  },

  legend: {
    total: "toplam",
  },

  screen: {
    empty:
      "Henüz metrik toplanmadı. Toplama işi ayarlardaki aralıkta çalışır; birkaç saniye içinde kartlar dolacak.",
    cpu: "İşlemci",
    memory: "Bellek",
    disk: "Disk",
    network: "Ağ",
    load: "Sistem yükü",
    uptime: "Çalışma süresi",
    cores: "{count} çekirdek",
    coresWithIo: "{count} çekirdek · G/Ç bekleme {io}",
    diskFree: "{mount} · {free} boş",
    netNote: "↓ indirme · ↑ {tx} yükleme",
    noInterfaces: "arayüz bulunamadı",
    loadNote: "5 dk {load5} · 15 dk {load15}",
    lastSample: "son örnek {age} sn önce",
    diskPartitions: "Disk bölümleri",
    loading: "yükleniyor…",
    resolution: "çözünürlük: {tier}",
    chartCpu: "İşlemci",
    chartMemory: "Bellek ve takas",
    chartNetwork: "Ağ trafiği",
    chartDisk: "Disk doluluğu",
    chartLoad: "Sistem yükü",
  },
};

export type MetricsDict = typeof metrics;
