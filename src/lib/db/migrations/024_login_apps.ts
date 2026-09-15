import type { Migration } from "./types";

/**
 * Giriş ekranında görünecek kartlar.
 *
 * Kart kaydı iç altyapı verisi taşıyor (internal_url, container_name,
 * monitor_id, widget yapılandırması) ve giriş ekranı reverse proxy üzerinden
 * dışarıya açık olabiliyor. Bu yüzden "hepsi görünsün" DEĞİL, kart başına
 * açık bir işaret: sahibi işaretlemedikçe hiçbir kart oturum açmamış birine
 * gösterilmez.
 *
 * DEFAULT 0 bu yüzden şart — yükseltme sonrası mevcut kurulumlardaki kartlar
 * kendiliğinden dışarı açılmamalı. Bir güvenlik kararının varsayılanı, onu
 * hiç fark etmeyen kullanıcı için de doğru olmalı.
 *
 * Sütun `enabled`in yanına, ayrı bir tabloya değil: bu bir kart özelliği,
 * kartla birlikte yaşayıp kartla birlikte silinmeli.
 */
export const migration024: Migration = {
  version: 24,
  name: "login_apps",
  up: `
ALTER TABLE apps ADD COLUMN show_on_login INTEGER NOT NULL DEFAULT 0;
`,
};
