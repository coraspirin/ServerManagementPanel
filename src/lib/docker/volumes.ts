import "server-only";

import { audit } from "@/lib/auth/audit";
import { getDockerProvider } from "@/lib/providers";
import { getNumber, getString } from "@/lib/settings";
import { looksLikeMissingLs, normalizePath, parseListing, type FileEntry } from "./listing";
import { readTar } from "./tar";

/**
 * Volume klonlama ve dışa aktarma (M3.33).
 *
 * ## Neden restic yedeğinin yanında ayrıca gerekiyor
 *
 * Yedekleme motorumuz (M3.4) ZAMANLANMIŞ ve BÜTÜNSEL: gece çalışıyor, her şeyi
 * bir depoya yazıyor, geri almak bir restore işlemi. Buradaki ihtiyaç başka:
 * riskli bir güncellemeden hemen ÖNCE "şu volume'ün bir kopyası dursun"
 * demek. Bir sonraki yedeği beklemek ya da tüm depoyu geri yüklemek bu iş
 * için orantısız.
 *
 * ## ⚠️ Tutarlılık uyarısı
 *
 * Kullanımdaki bir volume'ü kopyalamak, çalışan bir veritabanının dosyalarını
 * o yazarken kopyalamak demek olabilir — kopya yarım bir işlemi yakalarsa
 * bozuk olur. Panel bunu ENGELLEMİYOR (kullanıcı ne yaptığını bilerek de
 * isteyebilir) ama kullanan container varsa AÇIKÇA söylüyor.
 */

/** Kopyalama ve arşivleme için kullanılan tek seferlik container imajı. */
function helperImage(): string {
  return getString("files.helper_image") || "alpine:latest";
}

const KAYNAK = "/panel-kaynak";
const HEDEF = "/panel-hedef";

/** Volume adları Docker'ın kabul ettiği karakter kümesiyle sınırlı. */
const AD_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/;

export type VolumeOutcome = { ok: boolean; message: string };

type VolumeRaw = {
  Name?: string;
  Driver?: string;
  Options?: Record<string, string> | null;
  Labels?: Record<string, string> | null;
};

/**
 * Bir volume'ün içeriğini yeni bir volume'e kopyalar.
 *
 * Kaynak SALT OKUNUR bağlanıyor: kopyalama sırasında bir yazım hatası ya da
 * ters yönde çalışan bir komut kaynağı bozamamalı. Kopyalanan şey verinin
 * kendisi olduğu için bu, geri alınamaz bir hatanın tek gerçek koruması.
 */
export async function cloneVolume(
  source: string,
  target: string,
  actor: { username: string; userId: number },
): Promise<VolumeOutcome> {
  if (!AD_RE.test(source)) return { ok: false, message: "Kaynak volume adı geçersiz." };
  if (!AD_RE.test(target)) {
    return {
      ok: false,
      message: "Hedef volume adı geçersiz (harf/rakamla başlamalı, 2-64 karakter).",
    };
  }
  if (source === target) return { ok: false, message: "Kaynak ve hedef aynı olamaz." };

  const provider = getDockerProvider();

  const mevcut = await provider.volumes();
  if (!mevcut.some((entry) => entry.name === source)) {
    return { ok: false, message: `Kaynak volume bulunamadı: ${source}` };
  }
  if (mevcut.some((entry) => entry.name === target)) {
    // Var olanın üzerine kopyalamak, hedefteki veriyi sessizce ezmek olurdu.
    return { ok: false, message: `"${target}" zaten var. Başka bir ad seç.` };
  }

  /*
    Sürücü, seçenekler ve etiketler korunuyor. Varsayılan `local` sürücüyle
    yeni bir volume yaratmak, NFS ya da başka bir sürücü kullanan bir
    volume'ün kopyasını yanlış yerde oluşturmak demek olurdu — kopya var ama
    aslıyla aynı davranmıyor.
  */
  const raw = (await provider.inspectVolumeRaw(source).catch(() => null)) as VolumeRaw | null;

  try {
    await provider.createVolume({
      name: target,
      driver: raw?.Driver || "local",
      driverOpts: raw?.Options ?? {},
      // Compose'un kendi etiketleri KOPYALANMIYOR: kopya o yığına ait değil ve
      // ait göstermek, `compose down --volumes` ile silinmesine yol açardı.
      labels: Object.fromEntries(
        Object.entries(raw?.Labels ?? {}).filter(([key]) => !key.startsWith("com.docker.compose.")),
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "volume oluşturulamadı";
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.clone_volume",
      targetType: "volume",
      targetId: source,
      detail: `hedef ${target}: ${message}`,
      result: "error",
    });
    return { ok: false, message };
  }

  /*
    `cp -a` sahiplik, izin ve zaman damgalarını koruyor; `/kaynak/.` biçimi
    gizli dosyaları da kapsıyor (`/kaynak/*` kabuk genişletmesi onları atlar).
    Root olarak çalışıyor, aksi halde başka kullanıcıya ait dosyalar okunamaz.
  */
  const result = await getDockerProvider().runThrowaway({
    image: helperImage(),
    cmd: ["sh", "-c", `cp -a ${KAYNAK}/. ${HEDEF}/`],
    binds: [`${source}:${KAYNAK}:ro`, `${target}:${HEDEF}`],
    env: {},
    user: "0:0",
    namePrefix: "panel-volume-clone",
    timeoutMs: Math.max(60, getNumber("docker.volume_op_timeout")) * 1000,
  });

  const ok = result.exitCode === 0;

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "docker.clone_volume",
    targetType: "volume",
    targetId: source,
    detail: ok ? `hedef: ${target}` : `hedef ${target}: ${result.output.slice(0, 300)}`,
    result: ok ? "ok" : "error",
  });

  if (!ok) {
    // Yarım kalmış bir kopya, dolu sanılan boş bir volume demek. Temizlemek
    // "işlem başarısız" mesajının gerçekten doğru olmasını sağlıyor.
    await provider.removeResource("volume", target, false).catch(() => {});
    return {
      ok: false,
      message: `Kopyalama başarısız, hedef volume kaldırıldı: ${result.output.slice(0, 300)}`,
    };
  }

  return { ok: true, message: `"${source}" → "${target}" kopyalandı.` };
}

export type ExportResult =
  | { ok: true; archive: Buffer; filename: string }
  | { ok: false; message: string };

/**
 * Volume içeriğini tar arşivi olarak döndürür.
 *
 * Container BAŞLATILMIYOR — yalnızca yaratılıyor. `docker cp` durmuş (hatta
 * hiç başlamamış) container'larda da çalışıyor ve bir kabuk çalıştırmadan
 * dosya sistemine erişmenin en ucuz yolu bu.
 */
export async function exportVolume(
  name: string,
  actor: { username: string; userId: number },
): Promise<ExportResult> {
  if (!AD_RE.test(name)) return { ok: false, message: "Volume adı geçersiz." };

  const provider = getDockerProvider();

  /*
    Boyut ÖNCEDEN kontrol ediliyor. Arşiv belleğe alınıyor ve 20 GB'lık bir
    volume'ü indirmeye kalkmak paneli belleksiz bırakır. Docker boyutu
    hesaplayamadıysa (`-1`) engellenmiyor: bilinmezliği yasak saymak,
    ölçülemeyen her volume'ü dışa aktarılamaz yapardı.
  */
  const azami = Math.max(1, getNumber("docker.volume_export_max_mb")) * 1024 * 1024;
  const usage = await provider
    .diskUsage()
    .catch(() => ({ volumeBytes: {} as Record<string, number> }));
  const boyut = usage.volumeBytes[name];

  if (typeof boyut === "number" && boyut > azami) {
    return {
      ok: false,
      message:
        `Volume ${(boyut / 1024 ** 3).toFixed(2)} GB — dışa aktarma sınırı ` +
        `${(azami / 1024 ** 2).toFixed(0)} MB. Ayarlardan sınırı yükseltebilir ya da ` +
        "bu volume için yedekleme motorunu (restic) kullanabilirsin.",
    };
  }

  const payload = {
    Image: helperImage(),
    Cmd: ["true"],
    HostConfig: { Binds: [`${name}:${KAYNAK}:ro`], AutoRemove: false },
  };

  let containerId: string | null = null;

  try {
    try {
      containerId = await provider.createContainer(`panel-volume-export-${Date.now()}`, payload);
    } catch (error) {
      /*
        İmaj yerelde yoksa yaratma 404 veriyor. `runThrowaway` bu durumda
        imajı indiriyor; boş bir komut çalıştırıp indirmeyi tetiklemek,
        indirme mantığını burada ikinci kez yazmaktan iyi.
      */
      if (!/no such image|404/i.test(error instanceof Error ? error.message : "")) throw error;
      await provider.runThrowaway({
        image: helperImage(),
        cmd: ["true"],
        binds: [],
        env: {},
        namePrefix: "panel-volume-warm",
        timeoutMs: 300_000,
      });
      containerId = await provider.createContainer(`panel-volume-export-${Date.now()}`, payload);
    }

    const archive = await provider.readContainerArchive(containerId, KAYNAK);

    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.export_volume",
      targetType: "volume",
      targetId: name,
      detail: `${(archive.length / 1024 ** 2).toFixed(1)} MB arşiv`,
      result: "ok",
    });

    return { ok: true, archive, filename: `${name}.tar` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "arşiv oluşturulamadı";
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.export_volume",
      targetType: "volume",
      targetId: name,
      detail: message,
      result: "error",
    });
    return { ok: false, message };
  } finally {
    // Container hiç başlatılmadığı için silmesi ucuz; bırakılırsa listede
    // duran ve kimsenin ne olduğunu bilmediği bir kalıntı olurdu.
    if (containerId) await provider.removeContainer(containerId, true).catch(() => {});
  }
}

/**
 * Volume içindeki bir dizini listeler (M3.40, M3.44'te gezinilebilir oldu).
 *
 * ## Neden dosya yöneticisinden geçmiyor
 *
 * Volume detayındaki "Gözat" bağlantısı kullanıcıyı `/files` sayfasına
 * atıyordu ve orası çoğu zaman **açılmıyordu**: volume mountpoint'i
 * (`/var/lib/docker/volumes/…`) `files.roots` ayarının içinde değil ve dosya
 * yöneticisi izinli kökler dışına çıkmıyor. Yani bağlantı, çalışmayan bir yere
 * götürüyordu.
 *
 * Buradaki yol o kısıttan bağımsız: volume tek seferlik bir container'a
 * **salt okunur** bağlanıp `ls -la` çalıştırılıyor ve çıktı, container dosya
 * tarayıcısının kullandığı `parseListing` ile ayrıştırılıyor.
 *
 * ⚠️ **Yol container İÇİNDE kalmak zorunda.** İstemciden gelen yol
 * `normalizePath` ile temizleniyor (`..` çözülüyor) ve mount noktasının altında
 * olduğu ayrıca sınanıyor — aksi halde `../../etc/passwd` gibi bir yol
 * container'ın kendi kök dosya sistemini okuturdu.
 */
export async function listVolumePath(
  name: string,
  input: string,
): Promise<{ ok: true; path: string; entries: FileEntry[] } | { ok: false; message: string }> {
  if (!AD_RE.test(name)) return { ok: false, message: "Volume adı geçersiz." };

  const rel = normalizePath(input || "/");
  const target = rel === "/" ? KAYNAK : `${KAYNAK}${rel}`;
  if (target !== KAYNAK && !target.startsWith(`${KAYNAK}/`)) {
    return { ok: false, message: "Yol volume dışına çıkıyor." };
  }

  const result = await getDockerProvider().runThrowaway({
    image: helperImage(),
    // `--` sonrası: adı tire ile başlayan bir dizin, seçenek sanılmasın.
    cmd: ["ls", "-la", "--", target],
    binds: [`${name}:${KAYNAK}:ro`],
    env: {},
    // Root: başka kullanıcıya ait dosyaları listeleyebilmek için. Volume salt
    // okunur bağlı, yani yazma riski yok.
    user: "0:0",
    namePrefix: "panel-volume-ls",
    timeoutMs: 60_000,
  });

  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: looksLikeMissingLs(result.output)
        ? "Yardımcı imajda `ls` yok; ayarlardaki yardımcı imajı değiştirmen gerekiyor."
        : result.output.slice(0, 300) || "Dizin listelenemedi.",
    };
  }

  /*
    `parseListing` yolları verilen dizine göre kuruyor; container içindeki
    `/panel-kaynak` önekini kırpıp volume'e göre göreli yol üretiyoruz —
    istemci mount noktasının adını hiç görmemeli.
  */
  const entries = parseListing(result.output, target).map((entry) => ({
    ...entry,
    path: normalizePath(entry.path.slice(KAYNAK.length) || "/"),
  }));

  return { ok: true, path: rel, entries };
}

/**
 * Volume içindeki tek bir dosyayı okur.
 *
 * Container BAŞLATILMIYOR — yalnızca yaratılıyor; `docker cp` durmuş (hatta
 * hiç başlamamış) container'larda da çalışıyor. Arşiv `tar.ts` ile açılıp tek
 * dosya çıkarılıyor.
 */
export async function readVolumeFile(
  name: string,
  input: string,
): Promise<{ ok: true; filename: string; bytes: Buffer } | { ok: false; message: string }> {
  if (!AD_RE.test(name)) return { ok: false, message: "Volume adı geçersiz." };

  const rel = normalizePath(input);
  if (rel === "/") return { ok: false, message: "Dosya yolu gerekli." };

  const target = `${KAYNAK}${rel}`;
  if (!target.startsWith(`${KAYNAK}/`)) {
    return { ok: false, message: "Yol volume dışına çıkıyor." };
  }

  const provider = getDockerProvider();
  let containerId: string | null = null;

  try {
    containerId = await provider.createContainer(`panel-volume-read-${Date.now()}`, {
      Image: helperImage(),
      Cmd: ["true"],
      HostConfig: { Binds: [`${name}:${KAYNAK}:ro`], AutoRemove: false },
    });

    const archive = await provider.readContainerArchive(containerId, target);
    const entries = readTar(archive).filter((entry) => entry.type === "dosya");

    if (entries.length === 0) {
      return { ok: false, message: "Dosya bulunamadı ya da bir dizin." };
    }

    return {
      ok: true,
      filename: rel.split("/").pop() || "dosya",
      bytes: entries[0].data,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "dosya okunamadı",
    };
  } finally {
    if (containerId) await provider.removeContainer(containerId, true).catch(() => {});
  }
}

/**
 * Yeni bir volume yaratır (M3.44).
 *
 * Panelden bir yığın kurulabiliyordu ama ona volume verilemiyordu; tek yol
 * compose dosyasına yazıp `up` çalıştırmaktı. Sürücü ve seçenekler açıkta:
 * NFS ya da CIFS üzerinde volume tanımlamak yaygın ve `local` sürücünün
 * seçenekleriyle yapılıyor.
 */
export async function createVolume(
  input: { name: string; driver: string; options: Record<string, string>; labels: Record<string, string> },
  actor: { username: string; userId: number },
): Promise<VolumeOutcome> {
  const name = input.name.trim();
  if (!AD_RE.test(name)) {
    return {
      ok: false,
      message: "Volume adı geçersiz (harf/rakamla başlamalı, 2-64 karakter).",
    };
  }

  const provider = getDockerProvider();

  // Var olan bir adla çağrılırsa Docker MEVCUDU döndürüyor, hata vermiyor —
  // yani "oluşturuldu" demek yanlış olurdu. Kontrol burada.
  if ((await provider.volumes()).some((entry) => entry.name === name)) {
    return { ok: false, message: `"${name}" zaten var.` };
  }

  try {
    await provider.createVolume({
      name,
      driver: input.driver || "local",
      driverOpts: input.options,
      labels: input.labels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "volume oluşturulamadı";
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.create_volume",
      targetType: "volume",
      targetId: name,
      detail: message,
      result: "error",
    });
    return { ok: false, message };
  }

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "docker.create_volume",
    targetType: "volume",
    targetId: name,
    detail: input.driver,
    result: "ok",
  });

  return { ok: true, message: `"${name}" volume'ü oluşturuldu.` };
}
