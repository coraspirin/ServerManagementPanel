import type { SettingDef, SettingGroupDef, SettingType } from "@/lib/settings/types";

/**
 * TÜM ayarların tek kaynağı (T9).
 *
 * Ayarlar ekranı bu şemadan otomatik üretilir: tip → widget eşlemesi,
 * doğrulama, audit ve "varsayılana dön" bedava gelir. Yeni ayar eklemek
 * buraya bir satır yazmaktır.
 *
 * GELİŞTİRME İLKESİ (PLAN.md İlkeler #5): eşik, aralık, limit, saklama süresi
 * ve sıklık değerleri koda sabit yazılmaz — her milestone kendi ayarlarını
 * buraya ekler.
 */

export const settingGroups: SettingGroupDef[] = [
  { key: "general" },
  { key: "monitoring" },
  { key: "health" },
  { key: "alerts" },
  { key: "docker" },
  { key: "hardware" },
  { key: "home" },
  { key: "network" },
  { key: "tailscale" },
  { key: "proxy" },
  { key: "apps" },
  { key: "notify" },
  { key: "updates" },
  { key: "files" },
  { key: "logs" },
  { key: "security" },
  { key: "api" },
  { key: "integration" },
  { key: "jobs" },
];

/**
 * Bildirim seviyeleri — kanal başına en düşük seviye filtresi (M1.3).
 *
 * Yalnızca DEĞERLER: her seçeneğin ekranda görünen adı sözlükte
 * (`settings.items.<anahtar>.options`).
 */
export const LEVEL_OPTIONS = ["info", "warning", "critical"];

type ChannelField = {
  key: string;
  type: SettingType;
  default?: string | number | boolean;
};

/**
 * Bir bildirim kanalının ayarlarını üretir.
 *
 * Elle yazmak yerine üretilmesinin sebebi tembellik değil TUTARLILIK: her
 * kanalın mutlaka bir `enabled` ve bir `min_level` ayarı olmalı. Beş kanalı
 * elle yazmak, er ya da geç birinde `min_level`'ı unutmak demekti — ve bu,
 * "neden bu kanala bildirim düşmüyor?" diye saatlerce aranan türden bir hata.
 *
 * Anahtarlar `notify.<kanal>.<alan>` biçimindedir (ör. `notify.telegram.token`).
 *
 * `id` aynı zamanda BÖLÜM anahtarı: ayarlar ekranında kanalın başlığı
 * `settings.sections.<id>` üzerinden çevriliyor.
 */
function notifyChannel(id: string, fields: ChannelField[]): SettingDef[] {
  const fallback = (type: SettingType) =>
    type === "bool" ? false : type === "int" || type === "float" ? 0 : "";

  return [
    {
      key: `notify.${id}.enabled`,
      group: "notify",
      section: id,
      type: "bool",
      default: false,
    },
    ...fields.map<SettingDef>((field) => ({
      key: `notify.${id}.${field.key}`,
      group: "notify",
      section: id,
      type: field.type,
      default: field.default ?? fallback(field.type),
    })),
    {
      key: `notify.${id}.min_level`,
      group: "notify",
      section: id,
      type: "enum",
      default: "warning",
      options: LEVEL_OPTIONS,
    },
  ];
}

export const settingDefs: SettingDef[] = [
  // ---------- Genel ----------
  {
    key: "general.language",
    group: "general",
    type: "enum",
    default: "tr",
    options: ["tr", "en"],
  },
  {
    key: "general.theme",
    group: "general",
    type: "enum",
    default: "system",
    options: ["system", "light", "dark"],
  },
  {
    key: "general.timezone",
    group: "general",
    type: "string",
    default: "Europe/Istanbul",
    envVar: "TZ",
  },
  {
    key: "general.ui_refresh_interval",
    group: "general",
    type: "int",
    default: 5,
    min: 2,
    max: 120,
  },

  // ---------- İzleme & Saklama (T1) ----------
  {
    key: "monitoring.collect_interval",
    group: "monitoring",
    section: "collection",
    type: "int",
    default: 5,
    min: 5,
    max: 60,
  },
  {
    key: "monitoring.retention.raw_hours",
    group: "monitoring",
    section: "retention",
    type: "int",
    default: 24,
    min: 1,
    max: 168,
  },
  {
    key: "monitoring.retention.minute_days",
    group: "monitoring",
    section: "retention",
    type: "int",
    default: 7,
    min: 1,
    max: 90,
  },
  {
    key: "monitoring.retention.hour_days",
    group: "monitoring",
    section: "retention",
    type: "int",
    default: 90,
    min: 1,
    max: 730,
  },
  {
    key: "monitoring.retention.day_months",
    group: "monitoring",
    section: "retention",
    type: "int",
    default: 24,
    min: 1,
    max: 120,
  },
  {
    key: "monitoring.rollup_cron",
    group: "monitoring",
    section: "retention",
    type: "cron",
    default: "*/5 * * * *",
  },
  {
    key: "monitoring.disks",
    group: "monitoring",
    section: "collection",
    type: "string",
    default: "",
  },
  {
    key: "monitoring.net_interfaces",
    group: "monitoring",
    section: "collection",
    type: "string",
    default: "",
  },
  {
    key: "monitoring.chart_default_range",
    group: "monitoring",
    section: "charts",
    type: "enum",
    default: "24h",
    options: ["1h", "6h", "24h", "7d", "30d", "1y"],
  },

  // ---------- Servis izleme (M1.2) ----------
  {
    key: "health.interval",
    group: "health",
    type: "int",
    default: 60,
    min: 10,
    max: 3600,
    overridable: true,
  },
  {
    key: "health.timeout",
    group: "health",
    type: "int",
    default: 10,
    min: 1,
    max: 120,
    overridable: true,
  },
  {
    key: "health.retries",
    group: "health",
    type: "int",
    default: 2,
    min: 0,
    max: 10,
    overridable: true,
  },
  {
    key: "health.down_threshold",
    group: "health",
    type: "int",
    default: 3,
    min: 1,
    max: 20,
    overridable: true,
  },
  {
    key: "health.uptime_retention_months",
    group: "health",
    type: "int",
    default: 12,
    min: 1,
    max: 120,
  },

  // ---------- Alarm eşikleri ----------
  // İlkeler #5: eşikler koda sabit yazılmaz. M1.1'de yalnızca renk kodlamasını
  // sürerler; M1.3'te aynı değerler bildirim tetikler.
  {
    key: "alerts.cpu.warn",
    group: "alerts",
    section: "thresholds",
    type: "int",
    default: 80,
    min: 1,
    max: 100,
  },
  {
    key: "alerts.cpu.crit",
    group: "alerts",
    section: "thresholds",
    type: "int",
    default: 95,
    min: 1,
    max: 100,
  },
  {
    key: "alerts.ram.warn",
    group: "alerts",
    section: "thresholds",
    type: "int",
    default: 85,
    min: 1,
    max: 100,
  },
  {
    key: "alerts.ram.crit",
    group: "alerts",
    section: "thresholds",
    type: "int",
    default: 95,
    min: 1,
    max: 100,
  },
  {
    key: "alerts.disk.warn",
    group: "alerts",
    section: "thresholds",
    type: "int",
    default: 80,
    min: 1,
    max: 100,
    overridable: true,
  },
  {
    key: "alerts.disk.crit",
    group: "alerts",
    section: "thresholds",
    type: "int",
    default: 90,
    min: 1,
    max: 100,
    overridable: true,
  },

  // ---------- Docker (M1.6) ----------
  {
    key: "docker.stats_interval",
    group: "docker",
    section: "metering",
    type: "int",
    default: 15,
    min: 5,
    max: 300,
  },
  {
    key: "docker.restart_loop.window",
    group: "docker",
    section: "restartLoop",
    type: "int",
    default: 10,
    min: 1,
    max: 1440,
  },
  {
    key: "docker.restart_loop.threshold",
    group: "docker",
    section: "restartLoop",
    type: "int",
    default: 3,
    min: 2,
    max: 50,
  },
  {
    key: "docker.stop_timeout",
    group: "docker",
    section: "actions",
    type: "int",
    default: 10,
    min: 1,
    max: 300,
  },
  {
    key: "docker.log_tail_lines",
    group: "docker",
    section: "metering",
    type: "int",
    default: 200,
    min: 10,
    max: 5000,
  },
  {
    key: "docker.autoprune.enabled",
    group: "docker",
    section: "autoprune",
    type: "bool",
    default: false,
  },
  {
    key: "docker.autoprune.cron",
    group: "docker",
    section: "autoprune",
    type: "cron",
    default: "0 5 * * 0",
  },
  {
    key: "docker.autoprune.scope",
    group: "docker",
    section: "autoprune",
    type: "enum",
    default: "images-dangling",
    options: ["images-dangling", "build-cache", "containers", "images-unused", "volumes"],
  },
  {
    key: "updates.check_newer_tags",
    group: "docker",
    section: "updates",
    type: "bool",
    default: true,
  },

  {
    key: "updates.max_bump",
    group: "docker",
    section: "updates",
    type: "enum",
    options: ["yama", "minor", "major"],
    default: "minor",
  },

  {
    key: "updates.match_flavor",
    group: "docker",
    section: "updates",
    type: "bool",
    default: true,
  },

  {
    key: "updates.include_prerelease",
    group: "docker",
    section: "updates",
    type: "bool",
    default: false,
  },

  {
    key: "docker.update_vuln_gate",
    group: "docker",
    section: "updates",
    type: "enum",
    options: ["daha_kotu", "kritik", "kritik_yuksek", "kapali"],
    default: "daha_kotu",
  },

  {
    key: "docker.update_health_wait",
    group: "docker",
    section: "imageUpdates",
    type: "int",
    default: 30,
    min: 5,
    max: 600,
  },
  {
    key: "docker.exec_shell",
    group: "docker",
    section: "terminal",
    type: "enum",
    default: "auto",
    options: ["auto", "/bin/bash", "/bin/sh", "/bin/ash"],
  },
  {
    key: "docker.exec_idle_minutes",
    group: "docker",
    section: "terminal",
    type: "int",
    default: 15,
    min: 1,
    max: 240,
  },
  {
    key: "docker.show_stopped",
    group: "docker",
    section: "metering",
    type: "bool",
    default: true,
  },

  {
    key: "docker.image_export_max_mb",
    group: "docker",
    section: "metering",
    type: "int",
    default: 2048,
    min: 64,
    max: 40960,
  },

  {
    key: "docker.volume_op_timeout",
    group: "docker",
    section: "metering",
    type: "int",
    default: 600,
    min: 60,
    max: 7200,
  },
  {
    key: "docker.volume_export_max_mb",
    group: "docker",
    section: "metering",
    type: "int",
    default: 512,
    min: 16,
    max: 20480,
  },

  {
    key: "docker.events_enabled",
    group: "docker",
    section: "metering",
    type: "bool",
    default: true,
  },

  {
    key: "docker.events_retention_days",
    group: "docker",
    section: "metering",
    type: "int",
    default: 30,
    min: 1,
    max: 365,
  },

  {
    key: "docker.public_host",
    group: "docker",
    section: "metering",
    type: "string",
    default: "",
  },

  // ---------- Ağ (M2.9, M2.11) ----------
  {
    key: "network.scan_enabled",
    group: "network",
    section: "scanning",
    type: "bool",
    default: false,
  },
  {
    key: "network.scan_cron",
    group: "network",
    section: "scanning",
    type: "cron",
    default: "*/30 * * * *",
  },
  {
    key: "network.subnet",
    group: "network",
    section: "scanning",
    type: "string",
    default: "",
  },
  {
    key: "network.probe_timeout",
    group: "network",
    section: "scanning",
    type: "int",
    default: 1,
    min: 1,
    max: 10,
  },
  {
    key: "network.scan_concurrency",
    group: "network",
    section: "scanning",
    type: "int",
    default: 32,
    min: 1,
    max: 256,
  },
  {
    key: "network.oui_cron",
    group: "network",
    section: "scanning",
    type: "cron",
    default: "0 3 1 * *",
  },
  {
    key: "speedtest.enabled",
    group: "network",
    section: "speedtest",
    type: "bool",
    default: false,
  },
  {
    key: "speedtest.cron",
    group: "network",
    section: "speedtest",
    type: "cron",
    default: "0 */6 * * *",
  },
  {
    key: "speedtest.endpoint",
    group: "network",
    section: "speedtest",
    type: "string",
    default: "https://speed.cloudflare.com",
  },
  {
    key: "speedtest.duration_seconds",
    group: "network",
    section: "speedtest",
    type: "int",
    default: 10,
    min: 5,
    max: 30,
  },
  {
    key: "speedtest.max_bytes",
    group: "network",
    section: "speedtest",
    type: "int",
    default: 500000000,
    min: 25000000,
    max: 4000000000,
  },
  {
    key: "speedtest.streams",
    group: "network",
    section: "speedtest",
    type: "int",
    default: 4,
    min: 1,
    max: 8,
  },
  {
    key: "speedtest.download_bytes",
    group: "network",
    section: "speedtest",
    type: "int",
    default: 5000000,
    min: 1000000,
    max: 200000000,
  },
  {
    key: "speedtest.upload_bytes",
    group: "network",
    section: "speedtest",
    type: "int",
    default: 4000000,
    min: 1000000,
    max: 100000000,
  },
  {
    key: "speedtest.retention_days",
    group: "network",
    section: "speedtest",
    type: "int",
    default: 180,
    min: 7,
    max: 3650,
  },
  {
    key: "network.alert_unknown",
    group: "network",
    section: "scanning",
    type: "bool",
    default: true,
  },

  // ---------- Tailscale (M2.10) ----------
  {
    key: "tailscale.key_warn_days",
    group: "tailscale",
    type: "int",
    default: 14,
    min: 1,
    max: 180,
  },
  {
    key: "tailscale.check_cron",
    group: "tailscale",
    type: "cron",
    default: "45 4 * * *",
  },

  // ---------- Yayınlama & DDNS (M2.8) ----------
  {
    key: "proxy.caddy_container",
    group: "proxy",
    section: "reverseProxy",
    type: "container",
    default: "server-panel-caddy-1",
  },
  {
    key: "proxy.default_tls",
    group: "proxy",
    section: "reverseProxy",
    type: "enum",
    default: "auto",
    options: ["auto", "internal", "off"],
  },
  {
    key: "proxy.diagnose_timeout_seconds",
    group: "proxy",
    section: "reverseProxy",
    type: "int",
    default: 5,
    min: 2,
    max: 60,
  },
  {
    key: "proxy.diagnose_dns_server",
    group: "proxy",
    section: "reverseProxy",
    type: "string",
    default: "",
  },
  {
    key: "proxy.cert_check_cron",
    group: "proxy",
    section: "certificates",
    type: "cron",
    default: "30 4 * * *",
  },
  {
    key: "proxy.cert_warn_days",
    group: "proxy",
    section: "certificates",
    type: "int",
    default: 21,
    min: 1,
    max: 180,
  },
  {
    key: "proxy.ddns_cron",
    group: "proxy",
    section: "ddns",
    type: "cron",
    default: "*/15 * * * *",
  },
  {
    key: "proxy.public_ip_url",
    group: "proxy",
    section: "ddns",
    type: "string",
    default: "https://api.ipify.org",
  },

  // ---------- Ana sayfa (M2.7) ----------
  {
    key: "home.latitude",
    group: "home",
    section: "weather",
    type: "float",
    default: 0,
    min: -90,
    max: 90,
  },
  {
    key: "home.longitude",
    group: "home",
    section: "weather",
    type: "float",
    default: 0,
    min: -180,
    max: 180,
  },
  {
    key: "home.location_label",
    group: "home",
    section: "weather",
    type: "string",
    default: "",
  },
  {
    key: "home.internet_check_url",
    group: "home",
    section: "internetIndicator",
    type: "string",
    default: "https://1.1.1.1",
  },
  {
    key: "home.kiosk_refresh",
    group: "home",
    section: "kiosk",
    type: "int",
    default: 60,
    min: 10,
    max: 3600,
  },

  // ---------- Uygulamalar (M2.1, M2.5) ----------
  {
    key: "apps.server_host",
    group: "apps",
    section: "addressResolution",
    type: "string",
    default: "",
  },
  {
    key: "apps.widget_ttl",
    group: "apps",
    section: "serviceWidgets",
    type: "int",
    default: 30,
    min: 5,
    max: 600,
  },
  {
    key: "apps.discovery_enabled",
    group: "apps",
    section: "cardDiscovery",
    type: "bool",
    default: true,
  },
  {
    key: "apps.discovery_cron",
    group: "apps",
    section: "cardDiscovery",
    type: "cron",
    default: "*/10 * * * *",
  },
  {
    key: "apps.label_prefix",
    group: "apps",
    section: "cardDiscovery",
    type: "string",
    default: "panel",
  },
  /*
    Anahtar `apps.login_screen` olarak KALIYOR, adı artık sayfayı tam
    karşılamasa da. Yeniden adlandırmak, kullanıcının kapattığı listeyi
    yükseltme sırasında sessizce yeniden açardı — `appstore.*` anahtarları da
    aynı gerekçeyle bırakılmıştı. Aynı şey `apps.show_on_login` sütunu için
    de geçerli.
  */
  {
    key: "apps.login_screen",
    group: "apps",
    section: "welcomePage",
    type: "bool",
    default: true,
  },
  {
    key: "welcome.notice",
    group: "apps",
    section: "welcomePage",
    type: "richtext",
    default: "",
  },
  {
    key: "welcome.notice_level",
    group: "apps",
    section: "welcomePage",
    type: "enum",
    default: "info",
    options: ["info", "warn"],
  },

  // ---------- Donanım (M1.4) ----------
  {
    key: "alerts.temp.warn",
    group: "hardware",
    section: "temperature",
    type: "int",
    default: 70,
    min: 20,
    max: 120,
  },
  {
    key: "alerts.temp.crit",
    group: "hardware",
    section: "temperature",
    type: "int",
    default: 85,
    min: 20,
    max: 130,
  },
  {
    key: "hardware.temp_sources",
    group: "hardware",
    section: "temperature",
    type: "string",
    default: "",
  },
  {
    key: "hardware.raid.scrub_overdue_days",
    group: "hardware",
    section: "diskHealth",
    type: "int",
    default: 35,
    min: 7,
    max: 365,
  },
  {
    key: "hardware.report_stale_hours",
    group: "hardware",
    section: "diskHealth",
    type: "int",
    default: 6,
    min: 1,
    max: 168,
  },

  // ---------- Kapasite tahmini (M1.5) ----------
  {
    key: "alerts.capacity_forecast_days",
    group: "alerts",
    section: "capacityForecast",
    type: "int",
    default: 14,
    min: 1,
    max: 365,
  },
  {
    key: "capacity.window_days",
    group: "alerts",
    section: "capacityForecast",
    type: "int",
    default: 30,
    min: 7,
    max: 365,
  },
  {
    key: "capacity.min_history_days",
    group: "alerts",
    section: "capacityForecast",
    type: "int",
    default: 5,
    min: 2,
    max: 90,
  },
  {
    key: "capacity.min_confidence",
    group: "alerts",
    section: "capacityForecast",
    type: "int",
    default: 60,
    min: 0,
    max: 100,
  },

  // ---------- Alarm davranışı (M1.3) ----------
  {
    key: "alerts.flap_threshold",
    group: "alerts",
    section: "notifyBehaviour",
    type: "int",
    default: 2,
    min: 1,
    max: 10,
  },
  {
    key: "alerts.dedup_window",
    group: "alerts",
    section: "notifyBehaviour",
    type: "int",
    default: 30,
    min: 0,
    max: 1440,
  },
  {
    key: "alerts.escalate_after",
    group: "alerts",
    section: "notifyBehaviour",
    type: "int",
    default: 60,
    min: 0,
    max: 1440,
  },
  {
    key: "alerts.quiet_hours.enabled",
    group: "alerts",
    section: "quietHours",
    type: "bool",
    default: false,
  },
  {
    key: "alerts.quiet_hours.start",
    group: "alerts",
    section: "quietHours",
    type: "time",
    default: "23:00",
  },
  {
    key: "alerts.quiet_hours.end",
    group: "alerts",
    section: "quietHours",
    type: "time",
    default: "07:00",
  },
  {
    key: "alerts.quiet_hours.critical_bypass",
    group: "alerts",
    section: "quietHours",
    type: "bool",
    default: true,
  },
  {
    key: "alerts.retention_months",
    group: "alerts",
    section: "notifyBehaviour",
    type: "int",
    default: 12,
    min: 1,
    max: 120,
  },
  {
    key: "alerts.timeline_jump_pct",
    group: "alerts",
    section: "timeline",
    type: "int",
    default: 25,
    min: 5,
    max: 100,
  },
  {
    key: "alerts.timeline_net_jump_mbps",
    group: "alerts",
    section: "timeline",
    type: "int",
    default: 50,
    min: 1,
    max: 10000,
  },

  // ---------- Bildirim kanalları (M1.3) ----------
  // Her kanalın `min_level`'i var: aynı olay Telegram'a düşerken e-postaya
  // düşmeyebilir. Seviyeler: bilgi < uyarı < kritik.
  ...notifyChannel("telegram", [
    { key: "token", type: "secret" },
    { key: "chat_id", type: "string" },
  ]),
  ...notifyChannel("ha", [
    { key: "url", type: "string" },
    { key: "token", type: "secret" },
    { key: "service", type: "string" },
  ]),
  ...notifyChannel("ntfy", [
    { key: "url", type: "string" },
    { key: "topic", type: "string" },
    { key: "token", type: "secret" },
  ]),
  ...notifyChannel("discord", [{ key: "webhook", type: "secret" }]),
  ...notifyChannel("email", [
    { key: "smtp_host", type: "string" },
    { key: "smtp_port", type: "int", default: 587 },
    { key: "secure", type: "bool" },
    { key: "user", type: "string" },
    { key: "password", type: "secret" },
    { key: "from", type: "string" },
    { key: "to", type: "string" },
  ]),

  // ---------- Güncelleme ve yedek takibi (M1.10) ----------
  {
    key: "updates.os_alert_level",
    group: "updates",
    section: "os",
    type: "enum",
    default: "security",
    options: ["off", "security", "any"],
  },
  {
    key: "updates.report_stale_hours",
    group: "updates",
    section: "os",
    type: "int",
    default: 36,
    min: 1,
    max: 720,
  },
  {
    key: "updates.image_check_cron",
    group: "updates",
    section: "containerImages",
    type: "cron",
    default: "40 5 * * *",
  },
  {
    key: "updates.image_alert",
    group: "updates",
    section: "containerImages",
    type: "bool",
    default: false,
  },
  {
    key: "backup.watch_dir",
    group: "updates",
    section: "backupTracking",
    type: "string",
    default: "",
  },
  {
    key: "backup.stale_after_hours",
    group: "updates",
    section: "backupTracking",
    type: "int",
    default: 36,
    min: 1,
    max: 8760,
  },

  /*
    ---------- Compose yığınları ----------

    Anahtarlar `appstore.*` olarak KALDI. Şablon katalogu kaldırıldı ama
    değerler veritabanında anahtara göre duruyor; yeniden adlandırmak
    kullanıcının ayarladığı yığın dizinini ve dosya sahibini sessizce
    varsayılana düşürürdü — kurulumu bir daha çalışmayacak hâle getiren,
    hiçbir uyarı vermeyen bir değişiklik olurdu.
  */
  {
    key: "appstore.stacks_dir",
    group: "files",
    section: "composeStacks",
    type: "dir",
    default: "/opt/stacks",
  },
  {
    key: "appstore.file_owner",
    group: "files",
    section: "composeStacks",
    type: "owner",
    default: "0:0",
  },

  {
    key: "appstore.keep_backups",
    group: "files",
    section: "composeStacks",
    type: "int",
    default: 5,
    min: 1,
    max: 50,
  },

  {
    key: "docker.file_max_kb",
    group: "files",
    section: "containerFiles",
    type: "int",
    default: 512,
    min: 16,
    max: 20480,
  },

  // ---------- Host zamanlanmış görevleri (M3.9) ----------
  {
    key: "hostcron.forbidden",
    group: "files",
    section: "hostCron",
    type: "string",
    default: "rm -rf /,mkfs,dd if=,shutdown,reboot",
  },

  // ---------- Sunucu konsolu ----------
  {
    key: "console.forbidden",
    group: "files",
    section: "hostConsole",
    type: "string",
    default: "rm -rf /,mkfs,dd if=,:(){",
  },
  {
    key: "console.history_lines",
    group: "files",
    section: "hostConsole",
    type: "int",
    default: 5000,
    min: 200,
    max: 50000,
  },

  // ---------- Veritabanı yöneticisi (M3.6) ----------
  {
    key: "dbadmin.max_rows",
    group: "files",
    section: "dbAdmin",
    type: "int",
    default: 500,
    min: 10,
    max: 10000,
  },
  {
    key: "dbadmin.timeout_seconds",
    group: "files",
    section: "dbAdmin",
    type: "int",
    default: 30,
    min: 2,
    max: 600,
  },

  // ---------- Dosya yöneticisi (M3.5) ----------
  {
    key: "files.roots",
    group: "files",
    section: "access",
    type: "dirs",
    default: "/home,/mnt,/srv,/opt,/var/log",
  },
  {
    key: "files.max_edit_kb",
    group: "files",
    section: "access",
    type: "int",
    default: 512,
    min: 8,
    max: 10240,
  },
  {
    key: "files.max_download_mb",
    group: "files",
    section: "access",
    type: "int",
    default: 100,
    min: 1,
    max: 2048,
  },
  {
    key: "files.scan_timeout_seconds",
    group: "files",
    section: "diskAnalysis",
    type: "int",
    default: 20,
    min: 3,
    max: 300,
  },
  {
    key: "files.helper_image",
    group: "files",
    section: "access",
    type: "string",
    default: "alpine:latest",
  },

  // ---------- Yedekleme motoru (M3.4) ----------
  {
    key: "backup.restic_image",
    group: "updates",
    section: "backupEngine",
    type: "string",
    default: "restic/restic:latest",
  },
  {
    key: "backup.timeout_minutes",
    group: "updates",
    section: "backupEngine",
    type: "int",
    default: 120,
    min: 5,
    max: 1440,
  },

  // ---------- Merkezi log arama (M3.3) ----------
  {
    key: "logs.enabled",
    group: "logs",
    section: "collection",
    type: "bool",
    default: true,
  },
  {
    key: "logs.sources",
    group: "logs",
    section: "collection",
    type: "containers",
    default: "",
  },
  {
    key: "logs.max_lines_per_source",
    group: "logs",
    section: "collection",
    type: "int",
    default: 2000,
    min: 100,
    max: 50000,
  },
  {
    key: "logs.journald_enabled",
    group: "logs",
    section: "collection",
    type: "bool",
    default: false,
  },
  {
    key: "logs.retention_days",
    group: "logs",
    section: "storage",
    type: "int",
    default: 14,
    min: 1,
    max: 365,
  },
  {
    key: "logs.max_total_lines",
    group: "logs",
    section: "storage",
    type: "int",
    default: 2000000,
    min: 10000,
    max: 50000000,
  },

  // ---------- Güvenlik (T6) ----------
  {
    key: "security.audit_retention_months",
    group: "security",
    type: "int",
    default: 24,
    min: 1,
    max: 120,
  },
  {
    key: "security.trivy_image",
    group: "security",
    section: "vulnScan",
    type: "string",
    default: "aquasec/trivy:latest",
  },
  {
    key: "security.scan_timeout_minutes",
    group: "security",
    section: "vulnScan",
    type: "int",
    default: 15,
    min: 2,
    max: 120,
  },
  {
    key: "security.trivy_remote",
    group: "security",
    section: "vulnScan",
    type: "bool",
    default: false,
  },
  {
    key: "security.scan_retention_days",
    group: "security",
    section: "vulnScan",
    type: "int",
    default: 90,
    min: 7,
    max: 730,
  },
  {
    key: "security.upnp_enabled",
    group: "security",
    section: "portForward",
    type: "bool",
    default: false,
  },
  {
    key: "security.upnp_timeout_seconds",
    group: "security",
    section: "portForward",
    type: "int",
    default: 5,
    min: 2,
    max: 30,
  },
  {
    key: "security.session_ttl_hours",
    group: "security",
    type: "int",
    default: 12,
    min: 1,
    max: 720,
  },
  {
    key: "security.remember_me_days",
    group: "security",
    type: "int",
    default: 365,
    min: 1,
    max: 3650,
  },
  {
    key: "security.login_max_attempts",
    group: "security",
    type: "int",
    default: 5,
    min: 3,
    max: 20,
  },
  {
    key: "security.lockout_minutes",
    group: "security",
    type: "int",
    default: 15,
    min: 1,
    max: 1440,
  },

  // ---------- Panel işleri (T2) ----------
  {
    key: "jobs.sessions_prune_cron",
    group: "jobs",
    type: "cron",
    default: "30 * * * *",
  },
  {
    key: "jobs.api_tokens_prune_cron",
    group: "jobs",
    type: "cron",
    default: "45 4 * * *",
  },
  {
    key: "jobs.audit_prune_cron",
    group: "jobs",
    type: "cron",
    default: "30 4 * * *",
  },
  {
    key: "jobs.uptime_prune_cron",
    group: "jobs",
    type: "cron",
    default: "45 4 * * *",
  },
  {
    key: "jobs.events_prune_cron",
    group: "jobs",
    type: "cron",
    default: "50 4 * * *",
  },
  {
    key: "jobs.logs_collect_cron",
    group: "jobs",
    type: "cron",
    default: "*/5 * * * *",
  },
  {
    key: "jobs.logs_prune_cron",
    group: "jobs",
    type: "cron",
    default: "55 4 * * *",
  },
  {
    key: "jobs.vuln_scan_cron",
    group: "jobs",
    type: "cron",
    default: "0 5 * * 0",
  },
  {
    key: "jobs.upnp_scan_cron",
    group: "jobs",
    type: "cron",
    default: "20 * * * *",
  },
  {
    key: "jobs.port_scan_cron",
    group: "jobs",
    type: "cron",
    default: "40 * * * *",
  },
  {
    key: "jobs.backup_scheduler_cron",
    group: "jobs",
    type: "cron",
    default: "*/10 * * * *",
  },
  {
    key: "jobs.mqtt_publish_cron",
    group: "jobs",
    type: "cron",
    default: "*/2 * * * *",
  },

  // ---------- Dış Entegrasyon (MQTT) ----------
  {
    key: "integration.mqtt.enabled",
    group: "integration",
    section: "mqtt",
    type: "bool",
    default: false,
  },
  {
    key: "integration.mqtt.host",
    group: "integration",
    section: "mqtt",
    type: "string",
    default: "",
  },
  {
    key: "integration.mqtt.port",
    group: "integration",
    section: "mqtt",
    type: "int",
    default: 1883,
    min: 1,
    max: 65535,
  },
  {
    key: "integration.mqtt.tls",
    group: "integration",
    section: "mqtt",
    type: "bool",
    default: false,
  },
  {
    key: "integration.mqtt.username",
    group: "integration",
    section: "mqtt",
    type: "string",
    default: "",
  },
  {
    key: "integration.mqtt.password",
    group: "integration",
    section: "mqtt",
    type: "secret",
    default: "",
  },
  {
    key: "integration.mqtt.client_id",
    group: "integration",
    section: "mqtt",
    type: "string",
    default: "sunucu-paneli",
  },
  {
    key: "integration.mqtt.base_topic",
    group: "integration",
    section: "mqtt",
    type: "string",
    default: "panel",
  },
  {
    key: "integration.mqtt.timeout_seconds",
    group: "integration",
    section: "mqtt",
    type: "int",
    default: 10,
    min: 1,
    max: 120,
  },
  {
    key: "integration.mqtt.publish_events",
    group: "integration",
    section: "mqtt",
    type: "bool",
    default: true,
  },
  {
    key: "integration.mqtt.discovery",
    group: "integration",
    section: "mqtt",
    type: "bool",
    default: false,
  },
  {
    key: "integration.mqtt.discovery_prefix",
    group: "integration",
    section: "mqtt",
    type: "string",
    default: "homeassistant",
  },

  // ---------- Prometheus (T12) ----------
  // 022'de otomasyonla birlikte silinmişlerdi: anahtar üretecek arayüz
  // kalmayınca /metrics kullanılamaz hâle gelmişti. Arayüz geldi, ayarlar da
  // geri geliyor.
  {
    key: "integration.prometheus.enabled",
    group: "integration",
    section: "prometheus",
    type: "bool",
    default: false,
  },
  {
    key: "integration.prometheus.include_containers",
    group: "integration",
    section: "prometheus",
    type: "bool",
    default: false,
  },

  // ---------- Dış API (T12) ----------
  {
    key: "api.enabled",
    group: "api",
    type: "bool",
    default: false,
  },
  {
    key: "api.rate_limit_per_minute",
    group: "api",
    type: "int",
    default: 120,
    min: 1,
    max: 10000,
  },
  {
    key: "api.auth_rate_limit_per_minute",
    group: "api",
    type: "int",
    default: 10,
    min: 1,
    max: 1000,
  },
  {
    key: "api.token_default_ttl_days",
    group: "api",
    type: "int",
    default: 90,
    min: 0,
    max: 3650,
  },
  {
    key: "api.device_token_ttl_days",
    group: "api",
    type: "int",
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: "api.max_tokens_per_user",
    group: "api",
    type: "int",
    default: 20,
    min: 1,
    max: 200,
  },
  {
    key: "api.max_body_bytes",
    group: "api",
    type: "int",
    default: 65536,
    min: 1024,
    max: 10485760,
  },
  {
    key: "api.last_used_write_interval",
    group: "api",
    type: "int",
    default: 60,
    min: 0,
    max: 3600,
  },
  {
    key: "api.idempotency_window_seconds",
    group: "api",
    type: "int",
    default: 300,
    min: 30,
    max: 3600,
  },
  {
    key: "api.token_retention_days",
    group: "api",
    type: "int",
    default: 180,
    min: 0,
    max: 3650,
  },
];

const byKey = new Map(settingDefs.map((def) => [def.key, def]));

export function findSetting(key: string): SettingDef | undefined {
  return byKey.get(key);
}

export function findSettingGroup(key: string): SettingGroupDef | undefined {
  return settingGroups.find((group) => group.key === key);
}

export function defsOfGroup(groupKey: string): SettingDef[] {
  return settingDefs.filter((def) => def.group === groupKey);
}

/**
 * Bir kategorinin ayarlarını alt başlıklara böler.
 *
 * Alt başlık sırası, ayarın şemada ilk göründüğü yere göre belirlenir — ayrı
 * bir `order` alanı tutmak, er ya da geç iki ayarın aynı numarayı almasıyla
 * biterdi. Aynı ada sahip ayarlar şemada dağınık dursa bile tek blokta
 * toplanır: `alerts.temp.*` donanım bölümünün başında tanımlı olmasa da
 * "Sıcaklık" başlığı altında görünür.
 */
export function sectionsOfGroup<T extends { section?: string }>(
  defs: T[],
): { title: string | null; defs: T[] }[] {
  const sections: { title: string | null; defs: T[] }[] = [];

  for (const def of defs) {
    const title = def.section ?? null;
    const existing = sections.find((section) => section.title === title);
    if (existing) existing.defs.push(def);
    else sections.push({ title, defs: [def] });
  }

  return sections;
}
