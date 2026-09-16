/**
 * Giriş, iki adımlı doğrulama ve parola değiştirme ekranları.
 *
 * Bu ekranlar panel kabuğunun DIŞINDA: kullanıcı henüz içeri girmemiş olsa da
 * dilin doğru olması gerekiyor. Sağlayıcı kök layout'ta durduğu için burası da
 * kapsanıyor.
 */

export const auth = {
  login: {
    username: "Kullanıcı adı",
    password: "Parola",
    remember: "Beni hatırla",
    rememberHint: "Bu cihazda açık kal. Ortak kullanılan bir makinede işaretleme.",
    submit: "Giriş yap",
    submitBusy: "Giriş yapılıyor…",
    failed: "Giriş yapılamadı.",
    backToApps: "Uygulamalara dön",
  },

  twoFactor: {
    title: "İki adımlı doğrulama",
    hint: "Doğrulayıcı uygulamandaki 6 haneli kodu gir. Telefonun elinde değilse kurtarma kodlarından birini yazabilirsin.",
    submit: "Doğrula",
    submitBusy: "Doğrulanıyor…",
    restart: "Baştan başla",
    failed: "Doğrulanamadı.",
  },

  password: {
    title: "Parola değiştir",
    forcedNotice:
      "İlk giriş parolası kurulum logunda görünür. Devam etmeden önce değiştirmelisin.",
    current: "Mevcut parola",
    next: "Yeni parola (en az {min} karakter)",
    repeat: "Yeni parola (tekrar)",
    submit: "Parolayı değiştir",
    submitBusy: "Değiştiriliyor…",
    mismatch: "Yeni parolalar eşleşmiyor.",
    failed: "Parola değiştirilemedi.",
  },
};

export type AuthDict = typeof auth;
