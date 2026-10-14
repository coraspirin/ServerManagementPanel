import { existsSync } from "node:fs";

/**
 * Yerel sunucu yoklaması (kararlar.md D1) — saf modül, testler doğrudan
 * import eder.
 *
 * Panel host mount'ları olmadan da (yalnız ajanları yöneten bir merkez)
 * çalışabilsin diye yerel sunucu isteğe bağlı: açılışta docker.sock,
 * /host/proc ve /host/root'un ÜÇÜ DE yoksa yerel satır devre dışı bırakılır.
 * Biri bile varsa yerel etkin kalır; eksikler yetki yoklamasında
 * "kısmen" görünür.
 */

export type LocalMounts = { docker: boolean; proc: boolean; root: boolean };

/** Mount yolları — container içindeki varsayılanlar, env ile ezilebilir. */
export function localMountPaths(): { docker: string; proc: string; root: string } {
  return {
    docker: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
    proc: process.env.HOST_PROC ?? "/host/proc",
    root: process.env.HOST_ROOT ?? "/host/root",
  };
}

export function probeLocalMounts(): LocalMounts {
  const paths = localMountPaths();
  return {
    docker: existsSync(paths.docker),
    proc: existsSync(paths.proc),
    root: existsSync(paths.root),
  };
}

export type LocalDecision = "disable" | "enable" | "keep";

/**
 * - Üçü de yok ve yerel etkin → devre dışı bırak (+ "panel kapattı" işareti).
 * - En az biri var, yerel kapalı ve kapatan panelse → yeniden aç (+ işareti sil).
 * - Kullanıcının elle kapattığı yerele dokunulmaz.
 */
export function decideLocal(
  mounts: LocalMounts,
  state: { enabled: boolean; autoDisabled: boolean },
): LocalDecision {
  const anyMount = mounts.docker || mounts.proc || mounts.root;
  if (!anyMount) return state.enabled ? "disable" : "keep";
  if (!state.enabled && state.autoDisabled) return "enable";
  return "keep";
}
