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

/**
 * Etiket ve ipucu dil dosyasında: `console.preset.<key>.label` / `.hint`.
 */
export type ConsolePreset = {
  key: string;
  /** Host'ta çalışacak komutun okunabilir hâli. */
  command: string;
  /** Sistemi değiştiriyor mu — UI onay ister ve ayrı renklendirir. */
  mutates: boolean;
  /** Dil dosyasında `console.preset.<key>.hint` metni var mı. */
  hint?: boolean;
};

export const CONSOLE_PRESETS: ConsolePreset[] = [
  {
    key: "apt.update",
    command: "apt-get update",
    mutates: false,
    hint: true,
  },
  {
    key: "apt.list_upgrades",
    command: "apt list --upgradable",
    mutates: false,
  },
  {
    key: "apt.upgrade",
    command: "apt-get -y upgrade",
    mutates: true,
    hint: true,
  },
  {
    key: "apt.full_upgrade",
    command: "apt-get -y full-upgrade",
    mutates: true,
    hint: true,
  },
  {
    key: "apt.autoremove",
    command: "apt-get -y autoremove --purge",
    mutates: true,
  },
  {
    key: "reboot.required",
    command: "cat /var/run/reboot-required",
    mutates: false,
    hint: true,
  },
  {
    key: "disk.usage",
    command: "df -hT",
    mutates: false,
  },
  {
    key: "memory.usage",
    command: "free -h",
    mutates: false,
  },
  {
    key: "uptime",
    command: "uptime",
    mutates: false,
  },
  {
    key: "top.processes",
    command: "ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu",
    mutates: false,
  },
  {
    key: "journal.errors",
    command: "journalctl -p err -n 200",
    mutates: false,
  },
  {
    key: "docker.df",
    command: "docker system df",
    mutates: false,
  },
  {
    key: "docker.prune",
    command: "docker system prune -f",
    mutates: true,
    hint: true,
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
