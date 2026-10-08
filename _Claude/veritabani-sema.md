# Panel veritabanı şeması (SQLite)
Son güncelleme: 2026-10-09 · son migration `034_dbadmin_inventory`

Dosya: `data/panel.db` (container'da `/app/data`, named volume `panel-data`). Erişim `src/lib/db/client.ts` (`node:sqlite`, senkron, WAL, `foreign_keys = ON`). Migration'lar `src/lib/db/migrations/NNN_ad.ts` + `index.ts`'e kayıt; çalıştırıcı `src/lib/db/migrate.ts` (her migration öncesi `data/backups/pre-migration-NN.db` kopyası).

**host_id** sütununun anlamı: satır bir sunucuya ait; sorgular `currentHostId()` ile süzer. 026'da eklenenler FK değil (bkz. `026_multi_host.ts` açıklaması).

## Tablolar
| Tablo | Migration | host_id | Kullanan | Not |
|---|---|---|---|---|
| `hosts` | 001 (+026) | — | `lib/hosts/store.ts` | id 1 = yerel sunucu |
| `metrics_raw`, `metrics_1m`, `metrics_1h`, `metrics_1d` | 001 | ✓ (PK parçası) | `lib/metrics/*`, `lib/docker/collect.ts`, `lib/alerts/conditions.ts`, `lib/dashboard/summary.ts` | katmanlı zaman serisi; container ölçümleri de burada (label = container adı) |
| `users`, `roles`, `permissions`, `role_permissions`, `sessions` | 002 (+013) | sessions ✓ | `lib/auth/{users,session,login,bootstrap,apitoken}.ts` | izin kataloğu `permissions`'a migration'la eklenir |
| `audit_log` | 002 | ✓ | `lib/auth/audit.ts`, `lib/timeline`, `lib/security/fail2ban.ts` | |
| `settings`, `settings_seed_log` | 003 | kapsam sütunu | `lib/settings/index.ts` | yalnız varsayılandan sapmalar; tanımlar `src/settings.schema.ts` |
| `jobs`, `job_locks`, `job_runs` | 004 (+026 job_runs) | job_runs ✓ | `lib/jobs/runner.ts` | |
| `monitors`, `uptime_log`, `maintenance_windows` | 005 | monitors ✓ | `lib/monitors/*` | |
| `events`, `alert_state` | 006 | events ✓ | `lib/alerts/{engine,store}.ts` | |
| `runbooks` | 007 | ✓ | `lib/docker/runbooks.ts` | container ADINA bağlı |
| `cache` | 008 | — | `lib/db/cache.ts` | anahtar/değer önbellek (sunucu başına anahtar önekli) |
| `apps`, `app_categories`, `bookmarks`, `wol_devices`, `speedtest_results` | 009 (+024, +026 apps) | apps ✓ | `lib/apps/store.ts`, `lib/home/bookmarks.ts`, `lib/network/{wol,speedtest}.ts` | 024: karşılama sayfasında görünme bayrağı |
| `kiosk_tokens` | 010 | — | `lib/home/kiosk.ts` | token sha256 |
| `kiosk_widgets` | 032 | — | `lib/home/kiosk.ts`, `lib/dashboard/store.ts` | |
| `proxy_hosts`, `certificates`, `ddns_records` | 011 | — | `lib/proxy/*` | merkezi |
| `network_devices` | 012 | — | `lib/network/scan.ts` | yalnız yerel |
| `login_challenges`, `recovery_codes` | 013 | — | `lib/auth/twofactor.ts` | 2FA |
| `log_lines`, `log_fts` (FTS5), `log_patterns`, `log_cursors` | 014 (log_cursors 030'da yeniden kuruldu) | log_lines ✓, log_cursors PK(host_id, source) | `lib/logs/store.ts` | |
| `backup_repos`, `backup_jobs`, `backup_runs` | 015 (+026, +033) | ✓ | `lib/backup/store/*` | sistem işleri `sys:<kategori>:<sunucu>` adıyla |
| `backup_sources` | 033 | (iş üzerinden) | `lib/backup/store/jobs.ts` | |
| `db_connections` | 016 (+026, +034) | ✓ | `lib/dbadmin/store.ts` | 034: `transport`, `instance_key`, `meta_json`; envanter satırları `@<hostId>:<key>` |
| `db_query_history`, `db_saved_queries` | 016 | (bağlantı üzerinden) | `lib/dbadmin/store.ts` | geçmiş kullanıcı bazında |
| `port_forwards`, `vuln_scans` | 017 | — | `lib/security/{upnp,vuln}.ts` | |
| `port_expectations` | 017 | — | (kullanan kod yok) | |
| `app_stacks` | 018 → 029'da yeniden kuruldu | ✓, UNIQUE(host_id, name) | `lib/appstore/install.ts` | |
| `appstore_sources` | 021 | — | (kullanan kod yok — katalog kaldırıldı) | |
| `dashboard_widgets` | 020 (+031) | — | `lib/dashboard/store.ts` | kullanıcı başına düzen |
| `api_tokens` | 019 → 022 DROP → 025 yeniden | — | `lib/auth/apitoken.ts` | token sha256 |
| `automations`, `automation_runs` | 019 → 022 DROP | | | otomasyon kaldırıldı |

## Tuzaklar
- SQLite tablo genelindeki `UNIQUE` kısıtını tablo yeniden kurulmadan kaldıramaz; yeniden kurmak `foreign_keys = ON` iken FK CASCADE ile bağlı satırları siler (ör. `db_connections` → `db_query_history`). Çözüm örnekleri: 029/030 (yeni tablo + kopyala + RENAME, FK'siz tablolarda), 033/034 (benzersiz iç ad).
- `ALTER TABLE … ADD COLUMN` ile FK eklenemez → ilişkili tablolar birlikte açılır (009 notu).
- Migration'ı denemek: `test-dogrulama.md` → "Migration'ı bellekte dene".
