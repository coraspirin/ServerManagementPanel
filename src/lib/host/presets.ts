/**
 * Sunucu konsolunun hazır komut kalıpları.
 *
 * Burada YALNIZCA anahtar ve etiket var — çalışacak komut host tarafında,
 * `host-helper/panel-helper.py` içindeki `PRESETS` tablosunda sabittir. Panel
 * bir komut STRINGI göndermez; anahtarı gönderir, host argv'yi kendi kurar.
 * Bu yüzden bu dosyayı düzenlemek host'ta ne çalışacağını değiştirmez ve
 * container ele geçirilse bile yeni bir komut uydurulamaz.
 *
 * `command` alanı bilgi amaçlıdır: kullanıcı düğmeye basmadan önce ne
 * çalışacağını görmeli. Doğruluğu host tarafındaki tabloya bağlıdır, ikisi
 * birlikte güncellenir.
 *
 * Bu modülde `server-only` YOK: konsol bileşeni listeyi doğrudan okuyor.
 * Aynı listeyi bir de API'den taşımak, iki kaynağın ayrışmasıyla biterdi.
 */

export type ConsolePreset = {
  key: string;
  label: string;
  /** Host'ta çalışacak komutun okunabilir hâli. */
  command: string;
  /** Sistemi değiştiriyor mu — UI onay ister ve ayrı renklendirir. */
  mutates: boolean;
  hint?: string;
};

export const CONSOLE_PRESETS: ConsolePreset[] = [
  {
    key: "apt.update",
    label: "Paket listesini yenile",
    command: "apt-get update",
    mutates: false,
    hint: "Depolardan güncel sürüm bilgisini çeker; hiçbir paketi kurmaz.",
  },
  {
    key: "apt.list_upgrades",
    label: "Güncellenebilir paketleri listele",
    command: "apt list --upgradable",
    mutates: false,
  },
  {
    key: "apt.upgrade",
    label: "Paketleri güncelle",
    command: "apt-get -y upgrade",
    mutates: true,
    hint: "Kurulu paketleri yükseltir; paket kaldırmaz. Uzun sürebilir.",
  },
  {
    key: "apt.full_upgrade",
    label: "Tam yükseltme",
    command: "apt-get -y full-upgrade",
    mutates: true,
    hint: "Gerekirse paket KALDIRIR. Çekirdek ve bağımlılık değişimlerinde gerekir.",
  },
  {
    key: "apt.autoremove",
    label: "Artık paketleri temizle",
    command: "apt-get -y autoremove --purge",
    mutates: true,
  },
  {
    key: "reboot.required",
    label: "Yeniden başlatma gerekiyor mu",
    command: "cat /var/run/reboot-required",
    mutates: false,
    hint: "Dosya yoksa (çıkış kodu 1) yeniden başlatma gerekmiyor demektir.",
  },
  {
    key: "disk.usage",
    label: "Disk kullanımı",
    command: "df -hT",
    mutates: false,
  },
  {
    key: "memory.usage",
    label: "Bellek kullanımı",
    command: "free -h",
    mutates: false,
  },
  {
    key: "uptime",
    label: "Çalışma süresi ve yük",
    command: "uptime",
    mutates: false,
  },
  {
    key: "top.processes",
    label: "En çok CPU kullanan süreçler",
    command: "ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu",
    mutates: false,
  },
  {
    key: "journal.errors",
    label: "Son sistem hataları",
    command: "journalctl -p err -n 200",
    mutates: false,
  },
  {
    key: "docker.df",
    label: "Docker disk kullanımı",
    command: "docker system df",
    mutates: false,
  },
  {
    key: "docker.prune",
    label: "Kullanılmayan Docker verilerini sil",
    command: "docker system prune -f",
    mutates: true,
    hint: "Durdurulmuş container, kullanılmayan ağ ve dangling image'ları siler.",
  },
];

export function findPreset(key: string): ConsolePreset | undefined {
  return CONSOLE_PRESETS.find((preset) => preset.key === key);
}

/**
 * "Güncelle" düğmesinin sırası.
 *
 * Tek bir kalıp değil çünkü `apt-get upgrade`, önce `apt-get update`
 * çalışmadan eski paket listesini yükseltir — kullanıcı "güncelledim" sanıp
 * güncellenmemiş olur. İkisini host tarafında `&&` ile birleştirmek ise
 * serbest kabuk gerektirirdi; panel bu yüzden iki çağrı yapar.
 */
export const UPDATE_SEQUENCE = ["apt.update", "apt.upgrade"] as const;
