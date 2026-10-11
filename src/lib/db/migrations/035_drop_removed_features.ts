import type { Migration } from "./types";

/**
 * Kaldırılan özelliklerin tabloları ve artıkları (2026-10).
 *
 * Kullanıcı paneli sadeleştirdi: uygulama kartları + yer imleri + kiosk,
 * herkese açık karşılama sayfası, yayınlama (Caddy ters vekil, sertifika,
 * DDNS), Tailscale, güvenlik duvarı ekranı ve dış API (anahtarlar, /api/v1,
 * /metrics) kodla birlikte kalktı.
 *
 * Eski migration'lar (009, 010, 011, 024, 025, 026, 032) OLDUĞU GİBİ DURUYOR
 * — gerekçesi 022'de: uygulanmış bir adım değiştirilmez, yapılanı geri alan
 * yeni bir adım eklenir. 009'un `wol_devices` / `speedtest_results`
 * tabloları ve 010'un `panel.dashboard` izni kullanılmaya devam ediyor.
 *
 * Sıra yabancı anahtarlara göre: önce başka tabloya bağlı olanlar düşüyor.
 */
export const migration035: Migration = {
  version: 35,
  name: "drop_removed_features",
  up: `
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS ddns_records;
DROP TABLE IF EXISTS proxy_hosts;
DROP TABLE IF EXISTS kiosk_widgets;
DROP TABLE IF EXISTS kiosk_tokens;
DROP TABLE IF EXISTS apps;
DROP TABLE IF EXISTS app_categories;
DROP TABLE IF EXISTS bookmarks;
DROP TABLE IF EXISTS api_tokens;

DELETE FROM role_permissions WHERE permission_key IN ('apps.manage', 'kiosk.manage', 'proxy.manage', 'api.manage');
DELETE FROM permissions      WHERE key            IN ('apps.manage', 'kiosk.manage', 'proxy.manage', 'api.manage');

DELETE FROM settings WHERE key LIKE 'apps.%'
                        OR key LIKE 'welcome.%'
                        OR key LIKE 'proxy.%'
                        OR key LIKE 'tailscale.%'
                        OR key LIKE 'api.%'
                        OR key LIKE 'integration.prometheus.%'
                        OR key IN ('home.kiosk_refresh', 'jobs.api_tokens_prune_cron');
-- Kart başına ayar ezmeleri (scope 'app') sahipsiz kalırdı.
DELETE FROM settings WHERE scope_type = 'app';

-- İş tanımları koddan kalktı; satırlar Panel İşleri ekranında sahipsiz kalırdı.
DELETE FROM job_locks WHERE job_key IN ('apps.discover', 'proxy.certificates', 'proxy.ddns', 'tailscale.keys', 'api.tokens_prune');
DELETE FROM job_runs  WHERE job_key IN ('apps.discover', 'proxy.certificates', 'proxy.ddns', 'tailscale.keys', 'api.tokens_prune');
DELETE FROM jobs      WHERE key     IN ('apps.discover', 'proxy.certificates', 'proxy.ddns', 'tailscale.keys', 'api.tokens_prune');

-- Gösterge panelinden kalkan widget'lar (düzen çözümleyici bunları zaten
-- atlıyor; satırları tutmanın anlamı yok).
DELETE FROM dashboard_widgets WHERE widget_key IN ('apps', 'quicklinks');
`,
};
