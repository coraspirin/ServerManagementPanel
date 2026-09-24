import { runWithHost } from "./context.ts";

/**
 * Bir işi birden fazla sunucuda, her biri kendi bağlamında çalıştırır.
 * Saf modül (testlerden import edilir); sunucu listesini çağıran verir.
 *
 * Bir sunucunun hatası diğerlerini durdurmaz — çevrimdışı bir sunucu metrik
 * toplamayı tüm sunucular için kesmemeli.
 */

export type FanOutTarget = { id: number; name: string };

export type FanOutOutcome<T> =
  | { host: FanOutTarget; ok: true; value: T }
  | { host: FanOutTarget; ok: false; error: string };

export async function fanOut<T>(
  hosts: readonly FanOutTarget[],
  fn: (host: FanOutTarget) => Promise<T>,
  concurrency = 4,
): Promise<FanOutOutcome<T>[]> {
  const outcomes: FanOutOutcome<T>[] = new Array(hosts.length);
  let next = 0;

  const worker = async () => {
    while (next < hosts.length) {
      const index = next++;
      const host = hosts[index];
      try {
        const value = await runWithHost(host.id, () => fn(host));
        outcomes[index] = { host, ok: true, value };
      } catch (error) {
        outcomes[index] = {
          host,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return outcomes;
}

/**
 * Job ayrıntısı. Tek sunucuda eskisiyle birebir aynı metin (hata fırlatılır);
 * birden fazlasında "sunucu: ayrıntı" parçaları. Tüm sunucular başarısızsa
 * iş başarısız sayılır.
 */
export function summarizeOutcomes(outcomes: FanOutOutcome<string | undefined>[]): string | undefined {
  if (outcomes.length === 1) {
    const only = outcomes[0];
    if (!only.ok) throw new Error(only.error);
    return only.value;
  }

  if (outcomes.length > 0 && outcomes.every((outcome) => !outcome.ok)) {
    throw new Error(
      outcomes.map((outcome) => `${outcome.host.name}: ${outcome.ok ? "" : outcome.error}`).join(" · "),
    );
  }

  return outcomes
    .map((outcome) =>
      outcome.ok
        ? `${outcome.host.name}: ${outcome.value ?? "✓"}`
        : `${outcome.host.name}: ✖ ${outcome.error}`,
    )
    .join(" · ");
}
