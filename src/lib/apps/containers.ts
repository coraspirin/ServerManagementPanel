import "server-only";

import { getDockerProvider } from "@/lib/providers";
import { publishedTcpPorts } from "./discovery";

/**
 * Kart formunun container seçim listesi.
 *
 * Alan eskiden serbest metindi: kullanıcı container adını ve portunu ezberden
 * yazmak zorundaydı, yazım hatası ancak kart tıklandığında ortaya çıkıyordu.
 * Oysa panel ikisini de biliyor.
 *
 * Yalnızca ad ve yayınlanmış portlar geçiyor — form bunlardan fazlasını
 * kullanmıyor ve container listesinin tamamını istemciye taşımak (etiketler,
 * ağlar, durum) gereksiz.
 */
export type ContainerOption = { name: string; ports: number[] };

export async function containerOptions(): Promise<ContainerOption[]> {
  try {
    const containers = await getDockerProvider().list(true);
    return containers
      .map((container) => ({ name: container.name, ports: publishedTcpPorts(container) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  } catch {
    // Docker erişilemezse liste boş döner ve form serbest metne düşer:
    // kart eklemek Docker'ın ayakta olmasına bağlı olmamalı.
    return [];
  }
}
