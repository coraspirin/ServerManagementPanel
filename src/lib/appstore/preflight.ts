import "server-only";

import path from "node:path";

import { callHelper, helperConfigured } from "@/lib/host/helper";
import { serverT } from "@/lib/i18n/runtime";
// Tek yön: preflight → install. `allowLinesFor` install.ts'te duruyor çünkü
// hata metinlerini üreten `explainHelper` de aynı satırlara ihtiyaç duyuyor ve
// ters yönde bir import ESM döngüsü açardı (bu projede daha önce yaşandı:
// döngü çökmeden yükleniyor ama bağlantılardan biri undefined kalıyor).
import { allowLinesFor, stacksRoot } from "./install";

/**
 * M3.10 düzeltmesi — "Kur" düğmesine basmadan önce çalışacak mı?
 *
 * Yaşanmış olay: kullanıcı Vaultwarden'ı kurmayı denedi, compose dosyası
 * `/opt/stacks/vaultwarden` altına YAZILDI ama host-helper `compose.up`'ı
 * "argüman izin verilen desene uymuyor" diyerek reddetti. Kullanıcı sonunda
 * uygulamayı elle kurmak zorunda kaldı.
 *
 * Panel bunu baştan biliyor olabilirdi: izin listesi host tarafında (T4) ve
 * okunamıyor, ama SORULABİLİYOR. Burada zararsız bir `compose.config` çağrısı
 * yapılıyor — çözümlenmiş yapılandırmayı basmaktan başka bir şey yapmaz,
 * hiçbir container'a dokunmaz.
 *
 * Ayrım yanıtın ŞEKLİNDEN geliyor ve helper protokolünde nettir:
 *
 *   politika reddi → { ok: false, error: "..." }      (exitCode YOK)
 *   komut çalıştı  → { ok, exitCode, stdout, stderr } (error YOK)
 *
 * Yani izinli bir desendeki OLMAYAN bir dizin bile "çalıştı" sayılır ve
 * docker'ın kendi hatasını döndürür ("no configuration file provided").
 * Sunucuda dört ayrı dizinle ölçülüp doğrulandı.
 */

export type PreflightStatus = "ok" | "blocked" | "unknown";

export type PreflightResult = {
  status: PreflightStatus;
  /** Sınanan dizin — ekranda gösteriliyor. */
  directory: string;
  detail: string;
  /** Engelliyken host'a yapıştırılacak izin listesi satırları; yoksa boş. */
  allowLines: string;
};

export async function composePreflight(actor: {
  username: string;
  userId: number;
}): Promise<PreflightResult> {
  const root = stacksRoot();

  if (!helperConfigured()) {
    return {
      status: "unknown",
      directory: root,
      detail: serverT("preflight.helperMissing"),
      allowLines: "",
    };
  }

  // Var olmayan bir alt dizin sorularak yan etki ihtimali sıfırlanıyor:
  // izin verilse bile ortada çalıştırılacak bir compose dosyası yok.
  const probe = await callHelper(
    "compose.config",
    { dir: path.posix.join(root, ".panel-onkontrol") },
    actor,
  );

  if (probe.exitCode !== undefined) {
    return {
      status: "ok",
      directory: root,
      detail: serverT("preflight.ok", { root }),
      allowLines: "",
    };
  }

  const error = probe.error ?? "";

  if (error.includes("desene uymuyor")) { // i18n-ignore — host-helper protokol metni
    return {
      status: "blocked",
      directory: root,
      detail: serverT("preflight.blocked", { root }),
      allowLines: allowLinesFor(root),
    };
  }

  if (error.includes("izinli değil") || error.includes("bilinmeyen eylem")) { // i18n-ignore
    return {
      status: "unknown",
      directory: root,
      detail: serverT("preflight.untested"),
      allowLines: allowLinesFor(root),
    };
  }

  return {
    status: "unknown",
    directory: root,
    detail: serverT("preflight.failed", { error: error || serverT("preflight.noResponse") }),
    allowLines: "",
  };
}
