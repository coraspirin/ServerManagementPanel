/**
 * Uzak sunucuya erişilemediğinde fırlatılan hatalar. Saf modül.
 *
 * `code` API katmanında HTTP durumuna ve çeviri anahtarına eşlenir
 * (`hosts.errors.<code>`).
 */
export type HostErrorCode =
  /** Ajan yanıt vermiyor. */
  | "offline"
  /** Ajan protokol sürümü uyumsuz. */
  | "incompatible"
  /** Bu özellik uzak sunucuda (henüz) yok. */
  | "unsupported"
  /** TLS parmak izi kayıttakiyle eşleşmedi. */
  | "pinMismatch"
  /** İmza/sır reddedildi. */
  | "authFailed";

export class HostError extends Error {
  readonly code: HostErrorCode;
  readonly hostId: number;

  constructor(code: HostErrorCode, hostId: number, message?: string) {
    super(message ?? `host ${hostId}: ${code}`);
    this.name = "HostError";
    this.code = code;
    this.hostId = hostId;
  }
}

export function isHostError(error: unknown): error is HostError {
  return error instanceof HostError;
}

export const HOST_ERROR_STATUS: Record<HostErrorCode, number> = {
  offline: 503,
  incompatible: 503,
  unsupported: 501,
  pinMismatch: 502,
  authFailed: 502,
};
