import { panelContainerName } from "@/lib/host/self";
import { imageConfig, inheritEnv, inheritLabels } from "./inherit";
// Etiket ayrıştırması ortak modülde (M3.39): kayıt defteri portunu etiket
// sanmamak gibi ince kurallar üç yerde kopyalanmıştı.
import { splitReference } from "./reference";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { evaluateGate, isGateMode, type GateMode } from "@/lib/security/gate";
import { latestScans, scanImage } from "@/lib/security/vuln";
import { getNumber, getString } from "@/lib/settings";

/**
 * Tek-tık image güncellemesi (M1.11).
 *
 * Docker'da "container'ı güncelle" diye bir işlem YOKTUR. Yapılan şey her
 * zaman şudur: yeni image'ı çek, eski container'ın yapılandırmasını kopyala,
 * yenisini oluştur, eskisini kaldır. Bu yüzden asıl iş yapılandırmayı
 * kaybetmeden taşımak.
 *
 * ## Geri alma
 *
 * Eski container silinmiyor, **yeniden adlandırılıyor**. Yeni container
 * ayağa kalkmazsa (ya da healthcheck'i tutmazsa) yenisi silinip eskisi
 * eski adıyla geri başlatılıyor. Ancak bu sıra ile: önce eskiyi durdur,
 * sonra yenisini oluştur — aynı portu dinleyen iki container aynı anda
 * ayakta olamaz.
 *
 * ## Compose uyarısı
 *
 * Compose ile yönetilen bir container burada güncellenirse, bir sonraki
 * `docker compose up` onu compose dosyasındaki etikete göre yeniden
 * oluşturur. Güncelleme kaybolmaz (image etiketi aynıdır, yeni sürüm
 * yereldedir) ama compose dosyası bir digest'e sabitlenmişse geri döner.
 * Çağıran taraf bunu kullanıcıya söylemekle yükümlü.
 */

export type UpdateStep = { step: string; detail?: string };

export type UpdateResult = {
  container: string;
  oldImageId: string;
  newImageId: string;
  changed: boolean;
  steps: UpdateStep[];
  /**
   * CVE kapısı güncellemeyi engellediyse gerekçesi (M3.28).
   *
   * Dolu olduğunda `changed` false'tur ve container'a HİÇ dokunulmamıştır —
   * yeni imaj ve geçici etiketi de silinmiştir.
   */
  blockedBy?: string;
  /** Kapının verdiği karar; engellemese de kullanıcı taramanın sonucunu görsün. */
  scanSummary?: string;
};

type RawInspect = {
  Id: string;
  Name: string;
  Image: string;
  Config: Record<string, unknown> & {
    Image?: string;
    Hostname?: string;
    Env?: string[];
    Labels?: Record<string, string>;
  };
  HostConfig: Record<string, unknown>;
  NetworkSettings?: {
    Networks?: Record<string, Record<string, unknown>> | null;
  };
};

/**
 * Ağ uçlarından ÇALIŞMA ZAMANINA ait alanları atar.
 *
 * `IPAddress`, `MacAddress`, `EndpointID` gibi alanlar Docker'ın o container'a
 * verdiği değerlerdir; yeni container'a kopyalanırsa ya çakışır ya da
 * reddedilir. Kullanıcının tanımladığı `Aliases`, `IPAMConfig`, `Links` ve
 * `DriverOpts` korunur — servisin ağdaki adı bunlara bağlı.
 */
function cleanEndpoint(
  endpoint: Record<string, unknown>,
  shortId: string,
): Record<string, unknown> {
  const aliases = Array.isArray(endpoint.Aliases)
    ? (endpoint.Aliases as string[]).filter((alias) => !shortId.startsWith(alias))
    : undefined;

  const cleaned: Record<string, unknown> = {};
  if (aliases && aliases.length > 0) cleaned.Aliases = aliases;
  if (endpoint.IPAMConfig) cleaned.IPAMConfig = endpoint.IPAMConfig;
  if (endpoint.Links) cleaned.Links = endpoint.Links;
  if (endpoint.DriverOpts) cleaned.DriverOpts = endpoint.DriverOpts;
  return cleaned;
}

export async function updateContainerImage(
  containerId: string,
  onStep?: (step: UpdateStep) => void,
): Promise<UpdateResult> {
  const provider = getDockerProvider();
  const steps: UpdateStep[] = [];
  const record = (step: string, detail?: string) => {
    const entry = { step, detail };
    steps.push(entry);
    onStep?.(entry);
  };

  const raw = (await provider.inspectRaw(containerId)) as RawInspect | null;
  if (!raw) throw new Error(serverT("dockerUpdate.notFound"));

  const name = raw.Name.replace(/^\//, "");

  /*
    EMNİYET KİLİDİ (M3.27) — arayüzde değil BURADA.

    Panelin kendi container'ını güncellemek, paneli kendi işleminin ortasında
    durdurmak demek: süreç ölür, yeni container yaratılmaz, eski container
    `_panel_yedek` adıyla durur ve panel erişilemez hâle gelir. Reverse proxy
    için de aynısı — panele giden yolu keser ve kendini kurtaramaz.

    Kontrol arayüzde de var ama tek başına yeterli değil: bu fonksiyona API
    ucundan, zamanlanmış bir işten ya da toplu güncellemeden de gelinebiliyor.
    Tek geçiş noktası burası olduğu için kilit de burada.
  */
  if (name === panelContainerName()) {
    throw new Error(serverT("dockerUpdate.selfUpdate"));
  }

  const caddy = getString("proxy.caddy_container").trim();
  if (caddy && name === caddy) {
    throw new Error(serverT("dockerUpdate.proxyUpdate", { name: caddy }));
  }

  const reference = raw.Config.Image;
  if (!reference) throw new Error(serverT("dockerUpdate.noTag"));
  if (reference.includes("@")) {
    throw new Error(serverT("dockerUpdate.digestPinned"));
  }

  const oldImageId = raw.Image;

  record(serverT("dockerUpdate.step.pulling"), reference);
  for await (const line of provider.pullImage(reference)) {
    // Her satırı kaydetmek yüzlerce adım demek; yalnızca çağırana iletiliyor.
    onStep?.({ step: serverT("dockerUpdate.step.downloading"), detail: line });
  }

  const pulled = await provider.inspect(name);
  if (!pulled) throw new Error(serverT("dockerUpdate.vanished"));

  // Yeni image id'sini container listesinden değil, image listesinden alıyoruz:
  // container hâlâ eski image'ı kullanıyor.
  const images = await provider.images();
  const newImage = images.find((image) => image.tags.includes(reference));
  const newImageId = newImage?.id ?? oldImageId;

  if (newImageId === oldImageId) {
    record(serverT("dockerUpdate.step.upToDate"), serverT("dockerUpdate.alreadyInstalled"));
    return { container: name, oldImageId, newImageId, changed: false, steps };
  }

  /*
    GÜVENLİ ÇEKME (M3.28).

    `docker pull` yerel etiketi ANINDA yeni imaja çevirdi; şu anda container'ın
    `repo:tag` etiketi taranmamış bir imajı gösteriyor ve bu arada bir
    `compose up` olursa taranmamış imaj devreye girer. Etiketi hemen eski imaja
    geri alıp yeni imaja geçici bir etiket veriyoruz: bu andan itibaren
    dışarıdan bakan herkes hâlâ eski, bilinen imajı görüyor.

    Kapı kapalıysa bu dans atlanmıyor — tarama yapılmasa da etiketin bir süre
    taranmamış imajı göstermesi tek başına bir sorun değil; ama akışı ikiye
    bölmek iki ayrı hata yolu demek. Tek yol, her zaman aynı sıra.
  */
  const gate = getString("docker.update_vuln_gate");
  const mode: GateMode = isGateMode(gate) ? gate : "daha_kotu";

  const parts = splitReference(reference);
  let pendingTag: string | null = null;

  if (parts && mode !== "kapali") {
    pendingTag = `${parts.repo}:${parts.tag}-panel-bekliyor`;
    record(serverT("dockerUpdate.step.protectingTag"), pendingTag);

    try {
      // Sıra önemli: önce YENİ imaja geçici etiket, sonra ESKİ imajı asıl
      // etikete geri koy. Ters sırada yeni imaj bir an etiketsiz kalır ve
      // araya giren bir prune onu silebilir.
      await provider.tagImage(newImageId, parts.repo, `${parts.tag}-panel-bekliyor`);
      await provider.tagImage(oldImageId, parts.repo, parts.tag);
    } catch (error) {
      record(
        serverT("dockerUpdate.step.tagProtectionFailed"),
        error instanceof Error ? error.message : serverT("console.unknownError"),
      );
      pendingTag = null;
    }
  }

  if (mode !== "kapali") {
    // Digest ile sabitlenmiş referanslar buraya zaten gelmiyor (yukarıda
    // reddediliyor), ama etiket koruması kurulamadıysa güvenlik ağı yok —
    // kullanıcı bunu bilmeli.
    if (pendingTag === null) {
      record(
        serverT("dockerUpdate.step.noSafetyNet"),
        serverT("dockerUpdate.noSafetyNetDetail"),
      );
    }

    record(serverT("dockerUpdate.step.scanning"), pendingTag ?? reference);
    const fresh = await scanImage(pendingTag ?? reference);
    const current = latestScans().find((row) => row.image === reference && row.ok) ?? null;

    const verdict = evaluateGate(
      mode,
      fresh,
      current ? { critical: current.critical, high: current.high, medium: current.medium, low: current.low } : null,
    );

    if (!verdict.allowed) {
      record(serverT("dockerUpdate.step.blocked"), verdict.reason);

      // Yeni imajı ve geçici etiketini temizle; container'a hiç dokunulmadı.
      if (pendingTag) {
        await provider.removeResource("image", pendingTag, true).catch(() => {
          record(serverT("dockerUpdate.step.cleanupFailed"), serverT("dockerUpdate.removeManually", { tag: pendingTag ?? "" }));
        });
      }

      return {
        container: name,
        oldImageId,
        newImageId,
        changed: false,
        steps,
        blockedBy: verdict.reason,
        scanSummary: verdict.reason,
      };
    }

    record(serverT("dockerUpdate.step.gatePassed"), verdict.reason);

    // Onaylandı: asıl etiketi yeni imaja taşı, geçiciyi kaldır.
    if (pendingTag && parts) {
      await provider.tagImage(newImageId, parts.repo, parts.tag);
      await provider.removeResource("image", pendingTag, false).catch(() => {
        // Etiket kaldırılamadıysa imaj yine doğru; yalnızca fazladan bir etiket
        // kalır ve budamada temizlenir.
      });
    }
  }

  const backupName = `${name}_panel_yedek`;
  const stopTimeout = getNumber("docker.stop_timeout");
  const healthWait = getNumber("docker.update_health_wait");

  // Eski container'ı önce durdur: aynı portu dinleyen iki container aynı anda
  // ayakta olamaz ve yenisi "port zaten kullanımda" ile patlar.
  record(serverT("dockerUpdate.step.stopping"), name);
  await provider.action(raw.Id, "stop", stopTimeout).catch(() => {
    // Zaten durmuşsa sorun değil.
  });

  record(serverT("dockerUpdate.step.backingUp"), backupName);
  await provider.removeContainer(backupName, true).catch(() => {
    // Önceki bir güncellemeden kalmış yedek varsa temizlenir.
  });
  await provider.renameContainer(raw.Id, backupName);

  const networks = Object.entries(raw.NetworkSettings?.Networks ?? {});
  const shortId = raw.Id.slice(0, 12);

  const [firstNetwork, ...restNetworks] = networks;

  /*
    ENV VE LABEL DEVRALMA (M3.28) — düzeltilen bir hata.

    Önceden `{ ...raw.Config }` yazılıyordu ve bu, eski container'ın `Env` ve
    `Labels`'ını olduğu gibi taşıyordu. Sonuç: imajın KENDİ varsayılanları da
    eski sürümde donuyordu. Yeni imaj `APP_VERSION=2.0` getirse bile container
    güncellendikten sonra eskisini gösteriyordu.

    `inheritEnv`/`inheritLabels` yalnızca kullanıcının koyduğu ya da
    değiştirdiği değerleri taşıyor; imajınkiler düşürülüyor ve yeni imaj
    kendi değerini veriyor.
  */
  const oldImage = imageConfig(await provider.inspectImageRaw(oldImageId).catch(() => null));

  const payload: Record<string, unknown> = {
    ...raw.Config,
    Env: inheritEnv(raw.Config.Env as string[] | undefined, oldImage.env),
    Labels: inheritLabels(
      raw.Config.Labels as Record<string, string> | undefined,
      oldImage.labels,
    ),
    Image: reference,
    HostConfig: raw.HostConfig,
  };

  // Hostname Docker tarafından container id'sine eşitlenmişse kopyalanmaz;
  // yeni container kendi kimliğini alsın.
  if (typeof raw.Config.Hostname === "string" && shortId.startsWith(raw.Config.Hostname)) {
    delete payload.Hostname;
  }

  if (firstNetwork) {
    payload.NetworkingConfig = {
      EndpointsConfig: { [firstNetwork[0]]: cleanEndpoint(firstNetwork[1], shortId) },
    };
  }

  let newId: string | null = null;

  try {
    record(serverT("dockerUpdate.step.creating"), `${name} → ${reference}`);
    newId = await provider.createContainer(name, payload);

    // Docker `create` sırasında yalnızca tek ağ kabul eder; gerisi sonradan
    // bağlanır. Birden çok ağdaki bir container'da bu adım atlanırsa servis
    // yarısı erişilebilir halde kalırdı.
    for (const [networkName, endpoint] of restNetworks) {
      record(serverT("dockerUpdate.step.connectingNetwork"), networkName);
      await provider.connectNetwork(networkName, newId, cleanEndpoint(endpoint, shortId));
    }

    record(serverT("dockerUpdate.step.starting"), name);
    await provider.action(newId, "start", stopTimeout);

    record(serverT("dockerUpdate.step.verifying"), serverT("dockerUpdate.seconds", { count: healthWait }));
    const ok = await waitHealthy(newId, healthWait);
    if (!ok) throw new Error(serverT("dockerUpdate.unhealthy"));

    record(serverT("dockerUpdate.step.removingBackup"), backupName);
    await provider.removeContainer(backupName, true);

    return { container: name, oldImageId, newImageId, changed: true, steps };
  } catch (error) {
    // Geri alma: yeni container'ı kaldır, eskisini eski adıyla geri getir.
    record(serverT("dockerUpdate.step.rollingBack"), error instanceof Error ? error.message : serverT("console.unknownError"));
    if (newId) await provider.removeContainer(newId, true).catch(() => {});
    await provider.renameContainer(backupName, name).catch(() => {});
    await provider.action(backupName, "start", stopTimeout).catch(() => {});
    throw error instanceof Error ? error : new Error(serverT("dockerUpdate.failed"));
  }
}

/**
 * Container'ın gerçekten ayakta kaldığını doğrular.
 *
 * "Başlattım" demek yetmez: hatalı bir yapılandırmayla açılan container
 * saniyeler içinde çıkar ve geri alma penceresi kaçar. Healthcheck varsa
 * onun `healthy` demesi beklenir; yoksa yalnızca çalışır durumda kalması.
 */
async function waitHealthy(id: string, seconds: number): Promise<boolean> {
  const provider = getDockerProvider();
  const deadline = Date.now() + seconds * 1000;

  let sawHealthcheck = false;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const state = await provider.inspect(id);
    if (!state || !state.running) return false;

    if (state.health) {
      sawHealthcheck = true;
      if (state.health === "healthy") return true;
      if (state.health === "unhealthy") return false;
      continue;
    }

    // Healthcheck yoksa: süre boyunca çalışır kalması yeterli.
  }

  // Süre doldu. Healthcheck varsa hâlâ "starting" demektir — bunu başarısızlık
  // saymak, yavaş açılan bir servisi (Home Assistant dakikalar sürer) boş yere
  // geri almak olurdu. Container ayakta olduğu sürece kabul edilir.
  const state = await provider.inspect(id);
  if (!state?.running) return false;
  if (sawHealthcheck && state.health === "unhealthy") return false;
  return true;
}
