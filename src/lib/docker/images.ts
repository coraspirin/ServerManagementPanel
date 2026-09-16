import "server-only";

import { audit } from "@/lib/auth/audit";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getNumber } from "@/lib/settings";
import { validReference } from "./reference";

/**
 * Image etiketleme ve dışa aktarma (M3.39).
 *
 * ## "Yeniden adlandırma" diye bir şey yok
 *
 * Docker'da bir imajın ADI yoktur, **etiketleri** vardır — bir imaj sıfır, bir
 * ya da beş etiket taşıyabilir ve hepsi aynı imajı gösterir. Bu yüzden arayüzde
 * "yeniden adlandır" değil **"etiketle" / "etiketi kaldır"** deniyor:
 * kullanıcıya olmayan bir işlemi vaat etmek, ilk beklenmedik sonuçta güveni
 * bitirir.
 *
 * "Ad değiştirmek" iki adımdır: yeni etiketi ver, eskisini kaldır. İkisini tek
 * düğmeye bağlamadık — arada bir şey ters giderse (yeni etiket verildi, eskisi
 * kaldırılamadı) kullanıcı ne olduğunu görebilmeli.
 */

export type ImageOutcome = { ok: boolean; message: string };

/** İmaja yeni bir etiket verir. */
export async function tagImage(
  id: string,
  reference: string,
  actor: { username: string; userId: number },
): Promise<ImageOutcome> {
  const parsed = validReference(reference);
  if (!parsed) {
    return {
      ok: false,
      message: serverT("imagesLib.invalidTagExample"),
    };
  }

  try {
    await getDockerProvider().tagImage(id, parsed.repo, parsed.tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : "etiketlenemedi";
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.tag_image",
      targetType: "image",
      targetId: id,
      detail: `${reference}: ${message}`,
      result: "error",
    });
    return { ok: false, message };
  }

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "docker.tag_image",
    targetType: "image",
    targetId: id,
    detail: `${parsed.repo}:${parsed.tag}`,
    result: "ok",
  });

  return { ok: true, message: `Etiket eklendi: ${parsed.repo}:${parsed.tag}` };
}

/**
 * Bir etiketi kaldırır.
 *
 * `removeResource("image", "repo:tag")` kullanılıyor — Docker, imajın başka
 * etiketi varsa YALNIZCA o etiketi siler; son etiketse imajın kendisini siler.
 * Bu ayrımı kullanıcıya söylemek çağıranın işi.
 */
export async function untagImage(
  reference: string,
  actor: { username: string; userId: number },
): Promise<ImageOutcome> {
  const parsed = validReference(reference);
  if (!parsed) return { ok: false, message: serverT("imagesLib.invalidTag") };

  try {
    await getDockerProvider().removeResource("image", `${parsed.repo}:${parsed.tag}`, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("imagesLib.untagFailed");
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.untag_image",
      targetType: "image",
      targetId: reference,
      detail: message,
      result: "error",
    });
    return { ok: false, message };
  }

  audit({
    userId: actor.userId,
    username: actor.username,
    action: "docker.untag_image",
    targetType: "image",
    targetId: reference,
    result: "ok",
  });

  return { ok: true, message: serverT("imagesLib.untagged", { reference }) };
}

export type ImageExport =
  | { ok: true; archive: Buffer; filename: string }
  | { ok: false; message: string };

/**
 * İmajı tar arşivi olarak döndürür.
 *
 * Boyut ÖNDEN sınırlanıyor: arşiv belleğe alınıyor ve 4 GB'lık bir imajı
 * indirmeye kalkmak paneli belleksiz bırakır. Sınır ayardan geliyor çünkü
 * "büyük" tanımı sunucunun belleğine bağlı.
 */
export async function exportImage(
  id: string,
  sizeBytes: number | null,
  filename: string,
  actor: { username: string; userId: number },
): Promise<ImageExport> {
  const azami = Math.max(1, getNumber("docker.image_export_max_mb")) * 1024 * 1024;

  if (sizeBytes !== null && sizeBytes > azami) {
    return {
      ok: false,
      message: serverT("imagesLib.tooLarge", {
        size: (sizeBytes / 1024 ** 3).toFixed(2),
        limit: (azami / 1024 ** 2).toFixed(0),
      }),
    };
  }

  try {
    const archive = await getDockerProvider().exportImage(id);

    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.export_image",
      targetType: "image",
      targetId: id,
      detail: serverT("volumes.archiveSize", { size: (archive.length / 1024 ** 2).toFixed(1) }),
      result: "ok",
    });

    return { ok: true, archive, filename };
  } catch (error) {
    const message = error instanceof Error ? error.message : serverT("volumes.archiveFailed");
    audit({
      userId: actor.userId,
      username: actor.username,
      action: "docker.export_image",
      targetType: "image",
      targetId: id,
      detail: message,
      result: "error",
    });
    return { ok: false, message };
  }
}
