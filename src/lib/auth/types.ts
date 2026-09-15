export type PermissionKey =
  | "panel.view"
  | "metrics.view"
  | "monitors.manage"
  | "apps.manage"
  | "panel.dashboard"
  | "kiosk.manage"
  | "proxy.manage"
  | "network.manage"
  | "docker.view"
  | "docker.action"
  | "docker.exec"
  | "host.power"
  | "host.service"
  | "host.shell"
  | "settings.view"
  | "settings.edit"
  | "users.manage"
  | "audit.view"
  // Faz 3 (migration 013) — ekranları geldikçe kullanılmaya başlar.
  | "logs.view"
  | "backup.manage"
  | "files.read"
  | "files.write"
  | "db.read"
  | "db.write"
  | "security.view"
  | "security.manage"
  | "cron.manage"
  | "apps.install"
  | "repos.manage"
  | "vault.view"
  // T12 (migration 025) — dış API anahtarı üretme/iptal.
  | "api.manage";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  mustChangePassword: boolean;
  permissions: PermissionKey[];
};

export type ActiveSession = {
  user: SessionUser;
  csrfToken: string;
  expiresAt: number;
};

/*
  Çerez adları M3.45'te DEĞİŞTİ: panel_session → panel_sid, panel_csrf → panel_xsrf.

  ## Neden bir ad değişikliği gerekti

  Panel düz HTTP'ye geçince giriş çalışmaz oldu ve arıza tamamen sessizdi:
  `POST /api/auth/login` 200 dönüyor, oturum veritabanına yazılıyor,
  `Set-Cookie` gönderiliyor — ama bir sonraki istekte çerez geri gelmiyor,
  middleware oturumu göremiyor ve kullanıcı giriş sayfasına düşüyordu. Dışarıdan
  "giriş düğmesi tepki vermiyor" gibi görünüyordu.

  Sebep sunucuda değil tarayıcıdaydı. Panel uzun süre `https://myserver.local`
  üzerinden kullanıldığı için tarayıcıda `Secure` işaretli bir `panel_session`
  çerezi birikmişti. RFC 6265bis §5.4 ("Leave Secure Cookies Alone") diyor ki:
  GÜVENSİZ bir origin, aynı adı taşıyan `Secure` bir çerezin üzerine yazamaz —
  tarayıcı yeni çerezi tamamen yok sayar. Yani HTTP'den gelen yeni,
  `Secure`'suz çerez sessizce çöpe gidiyor, eski `Secure` çerez duruyor ama
  HTTP'de gönderilmiyordu. Sonsuz döngü.

  ## Neden "kullanıcı çerezlerini temizlesin" denmedi

  Çalışırdı ama tek seferlikti ve elle bir adımdı: paneli daha önce HTTPS'ten
  açmış HER tarayıcı ve HER cihaz aynı duvara çarpardı. Ad değişikliği aynı
  sorunu herkes için, hiçbir el işlemi olmadan çözüyor.

  Eski adlar tarayıcılarda kalıntı olarak durmaya devam eder; HTTP tarafında
  hiçbir şey ifade etmedikleri için zararsızdır.

  ## Bunun tekrar yaşanmaması için

  Asıl koşul, AYNI host'un hem HTTP hem HTTPS ile sunulmaması. Panel kendisini
  proxy kaydı olarak yayınlıyorsa (Ayarlar → Proxy & DDNS) o kaydın TLS ayarı
  "kapalı" olmalı; açık kalırsa bu sefer YENİ adlarla aynı tuzak kurulur.
*/
export const SESSION_COOKIE = "panel_sid";
export const CSRF_COOKIE = "panel_xsrf";
export const CSRF_HEADER = "x-csrf-token";
