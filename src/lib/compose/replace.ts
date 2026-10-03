import "server-only";

import { installComposeStack, type InstallOutcome } from "@/lib/appstore/install";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import type { RestartPolicy } from "@/lib/providers/types";
import { getNumber } from "@/lib/settings";

/**
 * Compose'a ait OLMAYAN bir container'ı, düzenlenmiş bir compose dosyasıyla
 * yeniden oluşturur (YAML sekmesi).
 *
 * Docker çalışan bir container'ın ortamını, ağ modunu ya da bağlamalarını
 * değiştirmeye izin vermiyor; tek yol yeniden oluşturmak. Eski container
 * SİLİNMİYOR: durdurulup `<ad>-eski-<tarih>` olarak yeniden adlandırılıyor ve
 * yeniden başlatma politikası "no" yapılıyor (sunucu yeniden açılınca yenisiyle
 * çakışmasın). Yeni yığın kurulamazsa her şey geri alınıp eski container
 * yeniden başlatılıyor. Eski kopya, kullanıcı yenisinin çalıştığından emin
 * olunca Docker sayfasından silinebilir.
 *
 * Veri: üretilen dosya isimli volume'leri ve bind mount'ları aynen taşıyor;
 * ANONİM volume'ler yeni container'a geçmez — denetim bulguları bunu söylüyor.
 */
export async function replaceWithStack(
  containerId: string,
  input: { name: string; compose: string },
  actor: { username: string; userId: number },
): Promise<InstallOutcome & { previous?: string }> {
  const provider = getDockerProvider();
  const detail = await provider.detail(containerId);
  if (!detail) return { ok: false, message: serverT("api.notFound.container") };

  const state = await provider.inspect(containerId);
  const wasRunning = state?.running === true;
  const originalName = detail.name.replace(/^\//, "");
  const originalPolicy: RestartPolicy = detail.restartPolicy;
  const previous = `${originalName}-eski-${stamp()}`;
  const timeout = getNumber("docker.stop_timeout");

  // 1) Eskiyi kenara al. Ad boşalmadan yeni container aynı adı alamaz,
  //    durmadan da portları serbest kalmaz.
  try {
    if (wasRunning) await provider.action(containerId, "stop", timeout);
    await provider.setRestartPolicy(containerId, { name: "no", maximumRetryCount: 0 });
    await provider.renameContainer(containerId, previous);
  } catch (error) {
    await rollback();
    return {
      ok: false,
      message: serverT("api.docker.replacePrepareFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  // 2) Yeni yığın.
  const outcome = await installComposeStack(input, actor);
  if (outcome.ok) {
    return {
      ...outcome,
      previous,
      message: serverT("api.docker.replaced", { message: outcome.message, previous }),
    };
  }

  // 3) Başarısız: eskiyi geri getir.
  await rollback(true);
  return {
    ...outcome,
    message: serverT("api.docker.replaceRolledBack", { message: outcome.message }),
  };

  async function rollback(renamed = false) {
    try {
      if (renamed) await provider.renameContainer(containerId, originalName);
    } catch {
      // Ad geri alınamazsa (yeni yığın adı aldıysa) eski container
      // `-eski-` adıyla durur; aşağıdaki başlatma yine denenir.
    }
    try {
      await provider.setRestartPolicy(containerId, originalPolicy);
    } catch {
      // Politika geri yüklenemezse container yine de başlatılmaya çalışılır.
    }
    if (wasRunning) {
      try {
        await provider.action(containerId, "start", timeout);
      } catch {
        // Başlatılamazsa kullanıcı Docker sayfasında durmuş olarak görür.
      }
    }
  }
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
