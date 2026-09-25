import "server-only";

import { serverT } from "@/lib/i18n/runtime";
import { currentHostId } from "./context";
import { HostError } from "./errors";
import { getHost, isLocalHost } from "./store";

/**
 * Sunucunun kendi dosya sistemine dokunan bir işi seçili sunucuda çalıştırır.
 *
 * Yerel sunucuda (ve mock sunucularda) `local()` doğrudan çalışır. Ajanlı
 * sunucuda aynı iş ajana `op` adıyla yaptırılır; ajan tarafında op, aynı
 * `local` fonksiyonunu kendi makinesinde çağırır (bkz. `agent/ops.ts`).
 *
 * Neden gerekli: `/host/root` altından doğrudan okuyan bir fonksiyon, uzak
 * sunucu seçiliyken sessizce MERKEZİN dosyasını okur — hata vermeden yanlış
 * veri göstermek, hiç göstermemekten kötü.
 */
export async function onHost<T>(op: string, args: unknown[], local: () => Promise<T>): Promise<T> {
  const hostId = currentHostId();
  if (isLocalHost(hostId)) return local();

  const host = getHost(hostId);
  if (host?.agentType === "mock") return local();
  if (!host || host.agentType !== "agent") {
    throw new HostError("unsupported", hostId, serverT("hosts.errors.unsupported"));
  }

  const { agentCall } = await import("@/lib/agent/client");
  return agentCall<T>(host, op, args);
}
