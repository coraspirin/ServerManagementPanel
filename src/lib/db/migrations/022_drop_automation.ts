import type { Migration } from "./types";

/**
 * Otomasyon bölümünün kaldırılması.
 *
 * Kullanıcı kural motorunu, webhook tetikleyicisini ve API anahtarlarını
 * bütünüyle kaldırmayı seçti. Sunucuda ölçüldü: 0 kural, 0 çalışma kaydı,
 * 0 anahtar — hiç kullanılmamış, yani veri kaybı yok.
 *
 * API anahtarları yalnızca Prometheus'un /metrics ucunu çekmesi içindi.
 * Anahtar üretecek arayüz kalmayınca o uç kullanılamaz hâle gelirdi; ikisi
 * birlikte gitti.
 *
 * 019 OLDUĞU GİBİ DURUYOR. Uygulanmış bir migration geriye dönük
 * değiştirilmez: mevcut kurulumlar onu çoktan çalıştırdı ve dosyayı
 * düzenlemek, sıfırdan kurulan bir panelle mevcut panelin farklı şema
 * üretmesi demek olurdu. Doğru yol, yapılanı geri alan yeni bir adım eklemek.
 *
 * `settings` satırları da siliniyor: şemadan kalkan bir anahtarın
 * veritabanında kalması zararsız görünür ama "bu ayar neden hiçbir şey
 * yapmıyor" sorusunu doğuran türden bir artıktır.
 */
export const migration022: Migration = {
  version: 22,
  name: "drop_automation",
  up: `
DROP TABLE IF EXISTS automation_runs;
DROP TABLE IF EXISTS automations;
DROP TABLE IF EXISTS api_tokens;

DELETE FROM role_permissions WHERE permission_key = 'automation.manage';
DELETE FROM permissions      WHERE key            = 'automation.manage';

DELETE FROM settings WHERE key IN (
  'jobs.automation_schedule_cron',
  'jobs.automation_prune_cron',
  'integration.prometheus.enabled',
  'integration.prometheus.include_containers',
  'integration.webhook_timeout_seconds',
  'integration.automation_history_keep'
);

-- İş kayıtları ve çalışma geçmişi: iş tanımı koddan kalktığı için bu satırlar
-- Panel İşleri ekranında sahipsiz kalırdı.
DELETE FROM job_locks WHERE job_key IN ('automation.schedule', 'automation.prune');
DELETE FROM job_runs  WHERE job_key IN ('automation.schedule', 'automation.prune');
DELETE FROM jobs      WHERE key     IN ('automation.schedule', 'automation.prune');
`,
};
