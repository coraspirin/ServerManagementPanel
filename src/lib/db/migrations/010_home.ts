import type { Migration } from "./types";

/**
 * M2.7 — ana sayfa, ev halkı görünümü ve kiosk.
 *
 * Bookmark tablosu M2.1'de açılmıştı; burada eklenen iki şey var: kiosk
 * token'ları ve "tam panoyu kim görür" yetkisi.
 */
export const migration010: Migration = {
  version: 10,
  name: "home",
  up: `
/*
  Kiosk erişimi (M2.7).

  Duvara asılı tablet için oturum açmak pratik değil: cihaz aylarca açık kalır,
  oturum süresi dolar ve ekran bir gün sessizce giriş sayfasına döner. Bunun
  yerine adresin içinde taşınan bir token var.

  Token DÜZ SAKLANMAZ, yalnızca sha256 özeti — oturum token'larıyla aynı
  gerekçe (M0.4): veritabanı sızarsa erişim ele geçmesin.

  Kiosk YALNIZCA okur: yazan hiçbir uç bu yolu kabul etmez. Bu yüzden token'a
  izin listesi bağlanmıyor; yapabileceği tek şey zaten sabit.
*/
CREATE TABLE kiosk_tokens (
  token_hash   TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by   TEXT    NOT NULL DEFAULT '',
  last_seen_at INTEGER,
  -- NULL = süresiz. Duvardaki ekranın kendiliğinden kararması istenmez.
  expires_at   INTEGER
) WITHOUT ROWID;

/*
  "Tam pano" yetkisi.

  Ev halkı görünümü rol ADINA bakarak seçilseydi ('izleyici' ise sadeleştir),
  M3.1'de özel rol tanımlayan kullanıcı bu davranışı değiştiremezdi. Yetkiye
  bağlamak, kararı rol düzenleyicisinin içine taşıyor.
*/
INSERT INTO permissions (key, description) VALUES
  ('panel.dashboard', 'Ana sayfada sistem panosunu görme (yoksa sade ev halkı görünümü)'),
  ('kiosk.manage',    'Kiosk erişim bağlantısı oluşturma ve iptal etme');

INSERT INTO role_permissions (role_id, permission_key) VALUES
  (1, 'panel.dashboard'), (1, 'kiosk.manage'),
  (2, 'panel.dashboard');
`,
};
