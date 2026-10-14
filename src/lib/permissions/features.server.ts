import "server-only";

import { isMockMode } from "@/lib/env";
import { probeLocalMounts } from "@/lib/hosts/local-probe";
import type { Host } from "@/lib/hosts/types";
import { serverT } from "@/lib/i18n/runtime";
import type { MessageKey } from "@/lib/i18n/translate";
import { evaluateHost, type FeatureEvaluation, type FeatureHost } from "./catalog";
import { hintHost } from "./hint.server";

/**
 * Yetki yoklaması (kararlar.md D6): sunucunun yeteneklerinden katalogdaki
 * her özelliğin durumu. Yerel sunucuda yetenekler açılış yoklamasıyla aynı
 * kaynaktan (mount'lar + HELPER_SECRET), ajanda `agent.hello`'dan gelir.
 * Ajan policy bilgisi (Faz B) gelince helper eylemleri de kesinleşecek.
 */
function featureHost(host: Host): FeatureHost | null {
  const base = hintHost(host);
  if (!base) return null;

  if (host.isLocal) {
    if (isMockMode()) {
      return { ...base, capabilities: { docker: true, proc: true, hostRoot: true, helper: true } };
    }
    const mounts = probeLocalMounts();
    return {
      ...base,
      capabilities: {
        docker: mounts.docker,
        proc: mounts.proc,
        hostRoot: mounts.root,
        helper: (process.env.HELPER_SECRET ?? "") !== "",
      },
    };
  }

  if (host.agentType === "mock") {
    return { ...base, capabilities: { docker: true, proc: true, hostRoot: true, helper: true } };
  }

  // Ajan henüz hiç bağlanmadıysa yetenekleri bilinmiyor.
  if (host.protocol === null) return null;
  const caps = host.capabilities;
  return {
    ...base,
    capabilities: {
      docker: caps.docker === true,
      // Ajan /host/proc'u ayrıca bildirmiyor; kurulum kitinde host köküyle
      // birlikte bağlanıyor.
      proc: caps.hostRoot === true,
      hostRoot: caps.hostRoot === true,
      helper: caps.helper === true,
    },
    ops: Array.isArray(caps.ops) ? caps.ops : null,
    helperActions: Array.isArray(caps.helperActions) ? caps.helperActions : null,
  };
}

/** Sunucu için özellik durumu; yetenekleri bilinmiyorsa null. */
export function hostFeatures(host: Host): FeatureEvaluation[] | null {
  const target = featureHost(host);
  if (!target) return null;
  return evaluateHost(target, (key, params) => serverT(key as MessageKey, params));
}
