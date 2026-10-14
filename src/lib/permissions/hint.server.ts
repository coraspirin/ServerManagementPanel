import "server-only";

import { currentHostIdOrNull } from "@/lib/hosts/context";
import { getHost } from "@/lib/hosts/store";
import type { Host } from "@/lib/hosts/types";
import { serverT } from "@/lib/i18n/runtime";
import type { MessageKey } from "@/lib/i18n/translate";
import { buildHint, type HintContext, type HintHost, type PermissionHint, type PermissionHintCode } from "./hint";

/** Sunucu satırından komut üretimi için özet. */
export function hintHost(host: Host | null): HintHost | null {
  if (!host) return null;
  return { id: host.id, name: host.name, address: host.address, local: host.isLocal };
}

/**
 * Sunucu tarafı ipucu: çeviri `serverT`, sunucu verilmezse geçerli bağlamın
 * sunucusu. API yanıtında `{ error, hint }` olarak döner (bkz. hint.ts).
 */
export function hintFor(
  code: PermissionHintCode,
  ctx: Omit<HintContext, "host"> & { hostId?: number | null } = {},
): PermissionHint {
  const { hostId, ...rest } = ctx;
  const id = hostId === undefined ? currentHostIdOrNull() : hostId;
  const host = id === null ? null : hintHost(getHost(id));
  return buildHint(code, { ...rest, host }, (key, params) => serverT(key as MessageKey, params));
}
