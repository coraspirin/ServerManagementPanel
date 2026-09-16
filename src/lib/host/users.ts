import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { hostRoot } from "@/lib/files/paths";

/**
 * Host'un kullanıcı ve grup listesi (M3.45).
 *
 * ## Neden var
 *
 * Panelde üç yerde host kullanıcısı elle yazılıyordu: host görevinin
 * çalıştıracağı kullanıcı, kurulan compose dosyalarının sahibi (`uid:gid`) ve
 * dolaylı olarak yığın dizini. Üçünde de yanlış yazım SESSİZ bir arıza
 * üretiyor — cron satırı hiç çalışmıyor, dosyalar root'a ait olup SSH'tan
 * düzenlenemiyor. Seçilen bir listede bu hata sınıfı hiç doğmuyor.
 *
 * ## Neden `/etc/passwd` okunuyor, `getent` çalıştırılmıyor
 *
 * Panel container'ının kendi `/etc/passwd`'si host'unkiyle ilgisiz; `getent`
 * çağırmak container'ın kullanıcılarını gösterirdi. Host kökü zaten
 * `/host/root` altında SALT-OKUNUR bağlı (M1.10) ve `passwd`/`group`
 * dünyaya açık dosyalar — yükseltilmiş yetkiye, host-helper'a ya da yeni bir
 * izin satırına gerek yok.
 *
 * `/etc/shadow` OKUNMUYOR: burada gereken tek şey ad ve numara.
 */

export type HostUser = {
  name: string;
  uid: number;
  gid: number;
  /** GECOS alanının ilk parçası — "Mucahid Erdogan" gibi. Boş olabilir. */
  comment: string;
  /** Giriş kabuğu; `nologin`/`false` olanlar servis hesabı sayılır. */
  shell: string;
  /**
   * Bu bir insan hesabı mı.
   *
   * Ayrım kabuktan ve uid aralığından geliyor: `nologin` kabuklu ya da 1000
   * altındaki hesaplar sistem/servis hesapları. root İSTİSNA — insan hesabı
   * değil ama üç kullanım yerinde de en olası seçim.
   */
  human: boolean;
};

export type HostGroup = {
  name: string;
  gid: number;
};

export type HostAccounts = {
  users: HostUser[];
  groups: HostGroup[];
  /** Liste okunamadıysa sebebi; okunduysa null. */
  error: string | null;
};

const NOLOGIN = /(nologin|\/false)$/;

function parsePasswd(text: string): HostUser[] {
  const users: HostUser[] = [];

  for (const line of text.split("\n")) {
    // Yorum ve boş satırlar; ayrıca NIS/LDAP devralma satırları ("+::::::").
    if (!line || line.startsWith("#") || line.startsWith("+") || line.startsWith("-")) continue;

    const [name, , uidText, gidText, gecos = "", , shell = ""] = line.split(":");
    const uid = Number.parseInt(uidText ?? "", 10);
    const gid = Number.parseInt(gidText ?? "", 10);
    if (!name || !Number.isInteger(uid) || !Number.isInteger(gid)) continue;

    users.push({
      name,
      uid,
      gid,
      comment: gecos.split(",")[0] ?? "",
      shell,
      human: uid === 0 || (uid >= 1000 && uid < 65534 && !NOLOGIN.test(shell)),
    });
  }

  // İnsan hesapları önce, sonra uid sırası: yirmi servis hesabının arasında
  // kendi kullanıcını aramak, seçim kutusunu elle yazmaktan kötü olurdu.
  return users.sort((a, b) => Number(b.human) - Number(a.human) || a.uid - b.uid);
}

function parseGroup(text: string): HostGroup[] {
  const groups: HostGroup[] = [];

  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("+") || line.startsWith("-")) continue;

    const [name, , gidText] = line.split(":");
    const gid = Number.parseInt(gidText ?? "", 10);
    if (!name || !Number.isInteger(gid)) continue;

    groups.push({ name, gid });
  }

  return groups.sort((a, b) => a.gid - b.gid);
}

export async function hostAccounts(): Promise<HostAccounts> {
  const root = hostRoot();

  try {
    const passwd = await readFile(path.posix.join(root, "etc/passwd"), "utf8");
    const group = await readFile(path.posix.join(root, "etc/group"), "utf8").catch(() => "");

    return { users: parsePasswd(passwd), groups: parseGroup(group), error: null };
  } catch {
    // Host kökü bağlı değilse liste yok. Bu bir HATA değil, bir yapılandırma
    // durumu: çağıran arayüz elle giriş alanına düşer.
    return {
      users: [],
      groups: [],
      error: serverT("hostUsers.unreadable", { path: `${root}/etc/passwd` }),
    };
  }
}
