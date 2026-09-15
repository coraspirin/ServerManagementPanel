import "server-only";

import path from "node:path";

import { callHelper, helperConfigured } from "@/lib/host/helper";
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
      detail:
        "host-helper yapılandırılmamış (HELPER_SECRET boş). Compose komutları " +
        "host'ta çalışmak zorunda olduğu için kurulum bu hâliyle çalışmaz.",
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
      detail: `Host, ${root} altında compose çalıştırmaya izin veriyor.`,
      allowLines: "",
    };
  }

  const error = probe.error ?? "";

  if (error.includes("desene uymuyor")) {
    return {
      status: "blocked",
      directory: root,
      detail:
        `Host, "${root}" dizininde compose çalıştırmaya İZİN VERMİYOR. Kur düğmesi ` +
        "compose dosyasını yazar ama uygulamayı başlatamaz. İzin listesi host " +
        "tarafında ve panel onu değiştiremez (bilinçli bir sınır). İki çözüm var: " +
        "yığın kök dizinini izinli bir yola çevir (Ayarlar → Dosyalar → Yığın kök " +
        "dizini) ya da host'ta root olarak aşağıdaki satırları ekle.",
      allowLines: allowLinesFor(root),
    };
  }

  if (error.includes("izinli değil") || error.includes("bilinmeyen eylem")) {
    return {
      status: "unknown",
      directory: root,
      detail:
        "Bu ADIM SINANAMADI: host'ta `compose.config` kapalı olduğu için dizin " +
        "deseni sorulamadı. Kurulum yine de çalışabilir — `compose.up` ayrı bir " +
        "satırdır. Sınamayı açmak istersen izin listesine `compose.config` ekle.",
      allowLines: allowLinesFor(root),
    };
  }

  return {
    status: "unknown",
    directory: root,
    detail: `Ön kontrol yapılamadı: ${error || "host-helper yanıt vermedi"}`,
    allowLines: "",
  };
}
