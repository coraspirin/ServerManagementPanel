import { updatable } from "@/lib/docker/labels";
import { panelContainerName } from "@/lib/host/self";
import { serverT } from "@/lib/i18n/runtime";
import { getDockerProvider } from "@/lib/providers";
import { getBool, getString } from "@/lib/settings";
import { suggestUpgrade, type Bump } from "./version";

/**
 * Container image'ları için güncelleme kontrolü (M1.10).
 *
 * ## Neden `docker pull` değil
 *
 * "Yeni sürüm var mı" sorusunun tek dürüst cevabı, kayıt defterindeki
 * manifest özetini (digest) yereldekiyle karşılaştırmaktır. `docker pull`
 * bunu da yapar ama farkı bulduğunda **indirir** — Home Assistant image'ı 3
 * GB; haftalık bir kontrol için bunu indirmek kabul edilemez. Bu yüzden
 * yalnızca manifest başlığı isteniyor (HEAD), gövde hiç indirilmiyor.
 *
 * ## Kimlik doğrulama
 *
 * Registry'ler token ister ama hangisinin nereden alınacağı sabit değil.
 * Docker Hub `auth.docker.io`, GHCR kendi `/token` ucunu kullanır. Bu yüzden
 * adresler koda gömülmedi: kimliksiz istek atılıyor, gelen `401` yanıtındaki
 * `WWW-Authenticate: Bearer realm=…,service=…,scope=…` başlığı okunup token
 * oradan alınıyor. Bu, kayıt defteri protokolünün kendi keşif mekanizması —
 * özel bir registry eklendiğinde de çalışır.
 *
 * Özel (private) image'lar için kimlik bilgisi yok: kimliksiz erişilemeyen
 * image "kontrol edilemedi" olarak işaretlenir. Sessizce "güncel" demek,
 * güvenlik yaması kaçırmak demekti.
 */

export type ImageUpdate = {
  container: string;
  /**
   * Otomatik ve toplu güncellemeye dahil mi (M3.27).
   *
   * `false` olmasının iki sebebi olabilir: kullanıcı `panel.update=false`
   * etiketi koymuştur, ya da container panelin kendisi / reverse proxy'dir —
   * ikincisi ETİKETLE AÇILAMAZ, emniyet kilididir.
   */
  updatable: boolean;
  /** `updatable` false ise sebebi; kullanıcı neden atlandığını görsün. */
  skipReason: string | null;
  /**
   * Daha yeni bir SÜRÜM ETİKETİ var mı (M3.29).
   *
   * Digest kontrolünden AYRI bir soru: `updateAvailable` "bu etiketin içeriği
   * değişti" der, bu ise "bu etiket eskidi" der. İkisi bağımsız — `1.24`
   * güncel olabilir ama `1.26` çıkmış olabilir.
   *
   * Öneri tek tıkla uygulanmıyor: etiketi değiştirmek compose dosyasına
   * dokunmak demek ve o karar kullanıcınındır.
   */
  newerTag: { tag: string; bump: string } | null;
  image: string;
  localDigest: string | null;
  remoteDigest: string | null;
  /** null = kontrol edilemedi (aşağıdaki `note` sebebi yazar). */
  updateAvailable: boolean | null;
  note: string | null;
};

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const REQUEST_TIMEOUT_MS = 12_000;

/** Etiket listesinde okunacak üst sınır — bazı depolarda binlerce etiket var. */
const TAG_PAGE_SIZE = 200;

type Ref = { registry: string; repository: string; tag: string };

/**
 * "ghcr.io/home-assistant/home-assistant:stable" → parçalar.
 *
 * İlk parçanın kayıt defteri mi yoksa kullanıcı adı mı olduğu ancak nokta ya
 * da iki nokta içerip içermediğine bakarak anlaşılır: `koenkk/zigbee2mqtt`
 * Docker Hub'daki bir kullanıcı, `ghcr.io/x/y` ise başka bir kayıt defteri.
 * Docker'ın kendi kuralı da budur.
 */
export function parseImageRef(reference: string): Ref | null {
  if (!reference || reference.startsWith("sha256:")) return null;

  let rest = reference;
  let registry = "registry-1.docker.io";

  const slash = rest.indexOf("/");
  if (slash !== -1) {
    const head = rest.slice(0, slash);
    if (head.includes(".") || head.includes(":") || head === "localhost") {
      registry = head;
      rest = rest.slice(slash + 1);
    }
  }

  // Digest ile sabitlenmiş referansta güncelleme kontrolünün anlamı yok.
  if (rest.includes("@")) return null;

  let tag = "latest";
  const colon = rest.lastIndexOf(":");
  if (colon !== -1 && !rest.slice(colon).includes("/")) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }

  // Docker Hub'da tek parçalı adlar `library/` altındadır.
  if (registry === "registry-1.docker.io" && !rest.includes("/")) rest = `library/${rest}`;

  return { registry, repository: rest, tag };
}

/** `WWW-Authenticate: Bearer realm="…",service="…",scope="…"` → token adresi. */
function tokenUrlFrom(header: string): string | null {
  if (!header.toLowerCase().startsWith("bearer ")) return null;

  const params = new Map<string, string>();
  for (const match of header.slice(7).matchAll(/(\w+)="([^"]*)"/g)) {
    params.set(match[1], match[2]);
  }

  const realm = params.get("realm");
  if (!realm) return null;

  const url = new URL(realm);
  const service = params.get("service");
  const scope = params.get("scope");
  if (service) url.searchParams.set("service", service);
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

/**
 * 401 gelirse token alıp isteği tekrarlar (M3.29'da ortaklaştırıldı).
 *
 * Kayıt defterleri anonim erişimde bile bir "pull token" istiyor ve bu akış
 * hem manifest hem etiket listesi için birebir aynı; iki kopya tutmak,
 * birinde düzeltilen bir hatanın diğerinde kalması demekti.
 */
async function withRegistryAuth(
  url: string,
  method: "GET" | "HEAD",
  accept: string,
): Promise<Response> {
  const headers: Record<string, string> = { accept };

  const send = () =>
    fetch(url, { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  let response = await send();

  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate");
    const tokenUrl = challenge ? tokenUrlFrom(challenge) : null;
    if (!tokenUrl) throw new Error(serverT("imageUpdates.authUrl"));

    const tokenResponse = await fetch(tokenUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) throw new Error(serverT("imageUpdates.tokenPrivate"));

    const payload = (await tokenResponse.json()) as { token?: string; access_token?: string };
    const token = payload.token ?? payload.access_token;
    if (!token) throw new Error(serverT("imageUpdates.token"));

    headers.authorization = `Bearer ${token}`;
    response = await send();
  }

  return response;
}

/**
 * Kayıt defterindeki etiket listesi (M3.29).
 *
 * `/v2/<repo>/tags/list` sayfalanabiliyor ama Docker Hub varsayılan olarak
 * hepsini döndürüyor; `n` parametresiyle üst sınır konuyor çünkü bazı
 * depolarda binlerce etiket var ve hepsini indirmek gereksiz. Sıralama kayıt
 * defterine göre değişiyor, o yüzden seçim `suggestUpgrade`'e bırakılıyor.
 */
async function remoteTags(ref: Ref): Promise<string[]> {
  const url = `https://${ref.registry}/v2/${ref.repository}/tags/list?n=${TAG_PAGE_SIZE}`;
  const response = await withRegistryAuth(url, "GET", "application/json");

  if (!response.ok) throw new Error(serverT("imageUpdates.tags", { status: response.status }));

  const payload = (await response.json()) as { tags?: string[] | null };
  return payload.tags ?? [];
}

async function remoteDigest(ref: Ref): Promise<string> {
  const url = `https://${ref.registry}/v2/${ref.repository}/manifests/${encodeURIComponent(ref.tag)}`;
  const response = await withRegistryAuth(url, "HEAD", MANIFEST_ACCEPT);

  if (response.status === 404) throw new Error(serverT("imageUpdates.tagMissing"));
  if (response.status === 401 || response.status === 403) {
    // Docker Hub var olmayan bir depo için 404 değil 401 döner. Bu yüzden
    // "yetkin yok" ile "böyle bir depo yok" ayırt edilemiyor — ikisini birden
    // söylemek, kullanıcıyı olmayan bir kimlik sorununu aramaya göndermekten
    // iyi. Yerel derlenmiş image'lar (kendi Dockerfile'ın) hep buraya düşer:
    // Docker onlara da bir digest atadığı için "kayıt defterinde yok"
    // olduklarını önceden anlamanın yolu yok.
    throw new Error(serverT("imageUpdates.notInRegistry"));
  }
  if (!response.ok) throw new Error(serverT("imageUpdates.registryStatus", { status: response.status }));

  const digest = response.headers.get("docker-content-digest");
  if (!digest) throw new Error(serverT("imageUpdates.noDigest"));
  return digest;
}

/** Yereldeki image'ın aynı repo için tuttuğu özet. */
function localDigestFor(repoDigests: string[], ref: Ref): string | null {
  for (const entry of repoDigests) {
    const at = entry.lastIndexOf("@");
    if (at === -1) continue;
    const name = entry.slice(0, at);
    // "koenkk/zigbee2mqtt" ya da "ghcr.io/x/y" — ikisi de aynı repoya işaret eder.
    if (name === ref.repository || name.endsWith(`/${ref.repository}`) || ref.repository.endsWith(name)) {
      return entry.slice(at + 1);
    }
  }
  return repoDigests.length === 1 ? repoDigests[0].split("@")[1] ?? null : null;
}

/**
 * Çalışan container'ların image'ları için güncelleme durumu.
 *
 * Aynı image'ı birden çok container kullanıyorsa kayıt defterine tek kez
 * gidilir; ağ isteği pahalı, cevap aynı.
 */
/**
 * Bu container otomatik/toplu güncellemeye dahil mi (M3.27).
 *
 * ⚠️ EMNİYET KİLİDİ, ETİKETLE AÇILAMAZ. Panelin kendi container'ı otomatik
 * güncellenirse panel kendini durdurup yeniden yaratmayı dener: süreç
 * ortasında ölür, işlem yarım kalır ve panel erişilemez hâle gelir. Reverse
 * proxy için de aynısı geçerli — panele giden yolu kesip kendini kurtaramaz.
 *
 * Bu ikisi elle, kullanıcının bildiği bir anda güncellenmeli. Etiket yalnızca
 * DİĞER container'lar için bir tercih; burası tercih değil.
 */
function updateEligibility(
  name: string,
  labels: Record<string, string>,
): { updatable: boolean; skipReason: string | null } {
  if (name === panelContainerName()) {
    return {
      updatable: false,
      skipReason: serverT("imageUpdates.skipSelf"),
    };
  }

  const caddy = getString("proxy.caddy_container").trim();
  if (caddy && name === caddy) {
    return {
      updatable: false,
      skipReason: serverT("imageUpdates.skipProxy"),
    };
  }

  if (!updatable(labels)) {
    return { updatable: false, skipReason: "panel.update=false etiketi" };
  }

  return { updatable: true, skipReason: null };
}

export async function checkImageUpdates(): Promise<ImageUpdate[]> {
  const provider = getDockerProvider();
  const [containers, images] = await Promise.all([provider.list(true), provider.images()]);

  const byId = new Map(images.map((image) => [image.id, image]));
  const byTag = new Map<string, (typeof images)[number]>();
  for (const image of images) for (const tag of image.tags) byTag.set(tag, image);

  const cache = new Map<string, { digest: string | null; note: string | null }>();
  // Aynı depodan birden çok container beslenebiliyor; etiket listesini depo
  // başına bir kez çekmek yeterli.
  const tagCache = new Map<string, string[]>();
  const results: ImageUpdate[] = [];

  const maxBump = getString("updates.max_bump");
  const semver = {
    enabled: getBool("updates.check_newer_tags"),
    options: {
      maxBump: (["yama", "minor", "major"] as const).includes(maxBump as Bump)
        ? (maxBump as Bump)
        : "minor",
      matchFlavor: getBool("updates.match_flavor"),
      includePrerelease: getBool("updates.include_prerelease"),
    },
  };

  for (const container of containers) {
    const image = byId.get(container.imageId) ?? byTag.get(container.image);
    const ref = parseImageRef(container.image);
    const eligibility = updateEligibility(container.name, container.labels);

    if (!ref) {
      results.push({
        container: container.name,
        image: container.image,
        localDigest: null,
        remoteDigest: null,
        updateAvailable: null,
        note: serverT("imageUpdates.digestPinned"),
        newerTag: null,
        ...eligibility,
      });
      continue;
    }

    const local = image ? localDigestFor(image.repoDigests, ref) : null;
    if (!local) {
      results.push({
        container: container.name,
        image: container.image,
        localDigest: null,
        remoteDigest: null,
        updateAvailable: null,
        note: serverT("imageUpdates.localBuild"),
        newerTag: null,
        ...eligibility,
      });
      continue;
    }

    const key = `${ref.registry}/${ref.repository}:${ref.tag}`;
    if (!cache.has(key)) {
      try {
        cache.set(key, { digest: await remoteDigest(ref), note: null });
      } catch (error) {
        cache.set(key, {
          digest: null,
          note: error instanceof Error ? error.message : "kontrol edilemedi",
        });
      }
    }

    const remote = cache.get(key)!;

    // Sürüm önerisi digest kontrolünden BAĞIMSIZ: etiketin içeriği güncel
    // olsa bile daha yeni bir etiket çıkmış olabilir. Hata yutuluyor çünkü
    // etiket listesi alınamaması digest sonucunu geçersiz kılmamalı.
    let newerTag: ImageUpdate["newerTag"] = null;
    if (semver.enabled) {
      try {
        const tags = tagCache.get(key) ?? (await remoteTags(ref));
        tagCache.set(key, tags);

        const suggestion = suggestUpgrade(ref.tag, tags, semver.options);
        if (suggestion) newerTag = { tag: suggestion.tag, bump: suggestion.bump };
      } catch {
        // Etiket listesi okunamadı; öneri yok, digest sonucu etkilenmiyor.
      }
    }

    results.push({
      container: container.name,
      image: container.image,
      localDigest: local,
      remoteDigest: remote.digest,
      updateAvailable: remote.digest === null ? null : remote.digest !== local,
      note: remote.note,
      newerTag,
      ...eligibility,
    });
  }

  return results.sort((a, b) => a.container.localeCompare(b.container, "tr"));
}
