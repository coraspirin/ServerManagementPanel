/**
 * Kabuk: sol menü çerçevesi, üstbar, tema düğmesi, sayfa yardımı ve komut
 * paleti. Yani her ekranda görünen, ekrana ait olmayan metinler.
 */

export const shell = {
  brand: "Sunucu Paneli",

  menu: {
    open: "Menüyü aç",
    close: "Menüyü kapat",
  },

  mode: {
    mock: "MOCK",
    live: "CANLI",
    mockTitle: "MOCK_MODE açık — veriler fixtures/ altından geliyor",
    liveTitle: "Gerçek veri kaynakları kullanılıyor",
  },

  search: {
    title: "Ara ve git (Ctrl+K)",
    label: "Ara ve git",
  },

  account: {
    title: "Hesabım — parola ve iki adımlı doğrulama",
  },

  logout: "Çıkış yap",

  theme: {
    title: "Aydınlık ve karanlık tema arasında geçiş yap",
    label: "Temayı değiştir",
  },

  help: {
    button: "Bu sayfa ne işe yarar?",
    how: "Nasıl çalışır",
    caution: "Dikkat",
  },

  palette: {
    label: "Komut paleti",
    placeholder: "Sayfa, container, uygulama veya servis ara…",
    empty: "Eşleşme yok.",
    emptyLoading: "Eşleşme yok (canlı kayıtlar yükleniyor…).",
    kind: {
      page: "Sayfa",
      container: "Container",
      app: "Uygulama",
      monitor: "Servis",
    },
  },
};

export type ShellDict = typeof shell;
