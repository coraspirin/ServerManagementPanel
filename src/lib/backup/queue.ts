import "server-only";

/**
 * Konum başına sıra: aynı restic deposuna iki işlem aynı anda yazmasın.
 * restic depo kilidi bunu zaten engelliyor ama ikinci işlem "repository is
 * already locked" hatasıyla düşerdi; burada beklemesi sağlanıyor.
 */

const chains: Map<string, Promise<unknown>> = ((globalThis as Record<string, unknown>).__panelBackupQueue ??=
  new Map()) as Map<string, Promise<unknown>>;

export function repoKey(hostId: number, repoId: number): string {
  return `${hostId}:${repoId}`;
}

/** Konum meşgulse `onWait` bir kez çağrılır; sıra gelince `task` çalışır. */
export async function withRepoLock<T>(key: string, task: () => Promise<T>, onWait?: () => void): Promise<T> {
  const previous = chains.get(key);
  if (previous) onWait?.();

  const run = (previous ?? Promise.resolve()).catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  try {
    return await run;
  } finally {
    if (chains.get(key) === tail) chains.delete(key);
  }
}

export function isRepoBusy(key: string): boolean {
  return chains.has(key);
}
