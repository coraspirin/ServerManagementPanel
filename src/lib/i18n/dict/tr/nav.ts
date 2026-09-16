/**
 * Sol menü ve komut paletindeki sayfa adları.
 *
 * `lib/nav.ts` artık metin değil ANAHTAR taşıyor; hangi ekranın hangi anahtarı
 * kullandığı oradaki `labelKey` alanından okunur.
 */

export const nav = {
  groups: {
    general: "Genel",
    monitoring: "İzleme",
    management: "Yönetim",
    networkSecurity: "Ağ & Güvenlik",
    system: "Sistem",
  },

  items: {
    overview: "Genel Bakış",
    apps: "Uygulamalar",
    monitoring: "İzleme",
    uptime: "Servis Durumu",
    events: "Olaylar",
    logs: "Loglar",
    docker: "Docker",
    database: "Veritabanı",
    files: "Dosyalar",
    backup: "Yedekleme",
    proxy: "Proxy",
    network: "Ağ",
    ports: "Port Haritası",
    firewall: "Güvenlik Duvarı",
    security: "Güvenlik",
    host: "Sunucu",
    users: "Kullanıcılar",
    audit: "Denetim Kayıtları",
    jobs: "Panel İşleri",
    hostcron: "Host Görevleri",
    settings: "Ayarlar",
    account: "Hesabım",
  },
};

export type NavDict = typeof nav;
