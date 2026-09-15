import http from "node:http";
import { randomBytes } from "node:crypto";
import type {
  ContainerDetail,
  ContainerPort,
  ContainerStats,
  ContainerState,
  ContainerSummary,
  DockerImage,
  DockerNetwork,
  DockerProvider,
  DockerVolume,
  ExecResult,
  ImageLayer,
  LogLine,
  PruneResult,
  PruneScope,
  RestartPolicy,
} from "./types";

/**
 * Docker Engine API'sine Unix soketi üzerinden erişim.
 *
 * M1.2 için yalnızca `inspect` gerekiyor (container tipi monitör). M1.6 bu
 * sağlayıcıyı listeleme, istatistik ve aksiyonlarla genişletecek — arayüz
 * şimdiden `providers/types.ts` içinde tanımlı ki o zaman yeni bir katman
 * uydurmak gerekmesin.
 *
 * `fetch` kullanılmıyor: Unix soketine bağlanmak için dispatcher gerekiyor ve
 * bu, ek bağımlılık (undici) demek. `node:http` soketi doğrudan destekliyor.
 */

const SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

type DockerResponse = { status: number; body: string };

function request(
  path: string,
  timeoutMs = 5000,
  method: "GET" | "POST" | "DELETE" = "GET",
  jsonBody?: unknown,
): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = jsonBody === undefined ? null : JSON.stringify(jsonBody);
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );

    req.on("timeout", () => req.destroy(new Error("Docker soketi zaman aşımına uğradı")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Docker'ın hata gövdesi `{"message": "..."}` biçiminde gelir. */
function dockerError(response: DockerResponse): Error {
  try {
    const parsed = JSON.parse(response.body) as { message?: string };
    if (parsed.message) return new Error(parsed.message);
  } catch {
    // Gövde JSON değilse ham metne düşülür.
  }
  return new Error(`Docker API ${response.status}: ${response.body.slice(0, 200)}`);
}

function expectJson<T>(response: DockerResponse): T {
  if (response.status !== 200) throw dockerError(response);
  return JSON.parse(response.body) as T;
}

type InspectPayload = {
  Name?: string;
  RestartCount?: number;
  Config?: { Tty?: boolean };
  State?: {
    Status?: string;
    Running?: boolean;
    StartedAt?: string;
    Health?: { Status?: string };
  };
};

export const liveDockerProvider: DockerProvider = {
  async inspect(nameOrId: string): Promise<ContainerState | null> {
    const response = await request(`/containers/${encodeURIComponent(nameOrId)}/json`);

    // 404 = böyle bir container yok. Bu bir hata değil, bir DURUM: monitör
    // "çevrimdışı" olarak işaretlenir, job hata vermez.
    if (response.status === 404) return null;
    if (response.status !== 200) {
      throw new Error(`Docker API ${response.status}: ${response.body.slice(0, 200)}`);
    }

    const data = JSON.parse(response.body) as InspectPayload;
    return {
      name: (data.Name ?? nameOrId).replace(/^\//, ""),
      running: data.State?.Running === true,
      status: data.State?.Status ?? "bilinmiyor",
      health: data.State?.Health?.Status ?? null,
      restartCount: data.RestartCount ?? 0,
      startedAt: data.State?.StartedAt ?? null,
      tty: data.Config?.Tty === true,
    };
  },

  async list(all: boolean): Promise<ContainerSummary[]> {
    const response = await request(`/containers/json?all=${all ? 1 : 0}`, 10_000);
    if (response.status !== 200) {
      throw new Error(`Docker API ${response.status}: ${response.body.slice(0, 200)}`);
    }

    const items = JSON.parse(response.body) as ListPayload[];
    return items.map(toSummary).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  },

  async stats(id: string): Promise<ContainerStats | null> {
    // stream=false + one-shot=false: Docker iki örnek toplayıp döner (~1 sn).
    // one-shot=true daha hızlı ama precpu_stats boş gelir ve CPU yüzdesi
    // hesaplanamaz — "0 %" göstermektense beklemek yeğdir.
    const response = await request(`/containers/${encodeURIComponent(id)}/stats?stream=false`, 15_000);
    if (response.status === 404 || response.status === 409) return null;
    if (response.status !== 200) {
      throw new Error(`Docker API ${response.status}: ${response.body.slice(0, 200)}`);
    }

    return parseStats(id, JSON.parse(response.body) as StatsPayload);
  },

  async action(id, action, stopTimeoutSeconds): Promise<void> {
    // stop/restart için `t`: Docker önce SIGTERM yollar, bu süre dolunca
    // SIGKILL'e geçer. Veritabanı container'ları için kısa bir süre veri
    // kaybına yol açabilir; bu yüzden ayardan geliyor.
    const query =
      action === "stop" || action === "restart" ? `?t=${stopTimeoutSeconds}` : "";
    const response = await request(
      `/containers/${encodeURIComponent(id)}/${action}${query}`,
      (stopTimeoutSeconds + 20) * 1000,
      "POST",
    );

    // 304 = zaten istenen durumda (başlatılmış container'ı başlatmak gibi).
    if (response.status === 204 || response.status === 304) return;
    if (response.status === 404) throw new Error("container bulunamadı");
    throw new Error(`Docker API ${response.status}: ${response.body.slice(0, 200)}`);
  },

  async *logs(id, options): AsyncGenerator<LogLine> {
    const state = await this.inspect(id);
    if (!state) throw new Error("container bulunamadı");

    const params = new URLSearchParams({
      stdout: "1",
      stderr: "1",
      timestamps: "1",
      tail: String(options.tail),
      follow: options.follow ? "1" : "0",
    });
    // Docker `since`'ı DAHİL kabul eder (>=). Toplayıcı aynı satırı iki kez
    // almasın diye imleç bir saniye ileriden veriliyor (bkz. logs/collect.ts).
    if (options.since !== undefined) params.set("since", String(options.since));

    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: SOCKET_PATH,
          path: `/containers/${encodeURIComponent(id)}/logs?${params}`,
          method: "GET",
        },
        resolve,
      );
      req.on("error", reject);
      options.signal.addEventListener("abort", () => req.destroy(), { once: true });
      req.end();
    });

    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Docker API ${response.statusCode}`);
    }

    /*
      Docker log akışı, container'da TTY YOKSA çerçevelenmiş gelir:
        [akış türü (1)][0,0,0][uzunluk (4, big-endian)][veri]
      TTY varsa ham metin akar. İkisini karıştırmak, log satırlarının başına
      okunmayan kontrol baytları düşmesi demektir — bu yüzden container'ın TTY
      durumu inspect ile öğrenilip ona göre ayrıştırılıyor.
    */
    const tty = state.tty;
    let buffer = Buffer.alloc(0);
    let text = "";

    for await (const chunk of response) {
      if (options.signal.aborted) break;

      if (tty) {
        text += (chunk as Buffer).toString("utf8");
        const lines = text.split("\n");
        text = lines.pop() ?? "";
        for (const line of lines) yield toLogLine("stdout", line);
        continue;
      }

      buffer = Buffer.concat([buffer, chunk as Buffer]);
      while (buffer.length >= 8) {
        const size = buffer.readUInt32BE(4);
        if (buffer.length < 8 + size) break;

        const stream = buffer[0] === 2 ? "stderr" : "stdout";
        const payload = buffer.subarray(8, 8 + size).toString("utf8");
        buffer = buffer.subarray(8 + size);

        for (const line of payload.split("\n")) {
          if (line.length > 0) yield toLogLine(stream, line);
        }
      }
    }

    if (text.trim().length > 0) yield toLogLine("stdout", text);
  },

  async prune(scope): Promise<PruneResult> {
    const { path, timeout } = pruneEndpoint(scope);
    const response = await request(path, timeout, "POST");

    if (response.status !== 200) {
      throw new Error(`Docker API ${response.status}: ${response.body.slice(0, 200)}`);
    }

    return parsePrune(scope, JSON.parse(response.body) as PrunePayload);
  },

  // --- M1.8 ---

  async inspectRaw(id: string): Promise<unknown | null> {
    const response = await request(`/containers/${encodeURIComponent(id)}/json`, 10_000);
    if (response.status === 404) return null;
    if (response.status !== 200) throw dockerError(response);
    return JSON.parse(response.body);
  },

  async detail(id: string): Promise<ContainerDetail | null> {
    const raw = (await this.inspectRaw(id)) as DetailPayload | null;
    return raw ? toDetail(raw) : null;
  },

  async images(): Promise<DockerImage[]> {
    // Kullanım bilgisi image listesinde YOK: hangi container'ın hangi image'ı
    // kullandığını ancak container listesinden öğrenebiliyoruz. İki çağrı
    // paralel gidiyor; "kullanılmıyor" damgasını yanlış basmak, silinmemesi
    // gereken bir image'ın silinmesi demek.
    const [imageResponse, containerResponse] = await Promise.all([
      request("/images/json", 15_000),
      request("/containers/json?all=1", 10_000),
    ]);

    const items = expectJson<ImagePayload[]>(imageResponse);
    const containers = expectJson<ListPayload[]>(containerResponse);

    const usage = new Map<string, string[]>();
    for (const container of containers) {
      const name = (container.Names?.[0] ?? container.Id).replace(/^\//, "");
      for (const key of [container.ImageID, container.Image]) {
        if (!key) continue;
        usage.set(key, [...(usage.get(key) ?? []), name]);
      }
    }

    return items
      .map<DockerImage>((item) => {
        const tags = (item.RepoTags ?? []).filter((tag) => tag !== "<none>:<none>");
        const usedBy = [
          ...new Set([...(usage.get(item.Id) ?? []), ...tags.flatMap((tag) => usage.get(tag) ?? [])]),
        ];

        return {
          id: item.Id,
          tags,
          createdAt: item.Created ?? 0,
          sizeBytes: item.Size ?? 0,
          usedBy: usedBy.sort((a, b) => a.localeCompare(b, "tr")),
          dangling: tags.length === 0,
          repoDigests: item.RepoDigests ?? [],
          labels: item.Labels ?? {},
        };
      })
      .sort((a, b) => (a.tags[0] ?? "").localeCompare(b.tags[0] ?? "", "tr"));
  },

  async volumes(): Promise<DockerVolume[]> {
    const [volumeResponse, containerResponse] = await Promise.all([
      request("/volumes", 10_000),
      request("/containers/json?all=1", 10_000),
    ]);

    const payload = expectJson<{ Volumes: VolumePayload[] | null }>(volumeResponse);
    const containers = expectJson<ListPayload[]>(containerResponse);

    const usage = new Map<string, string[]>();
    for (const container of containers) {
      const name = (container.Names?.[0] ?? container.Id).replace(/^\//, "");
      for (const mount of container.Mounts ?? []) {
        if (!mount.Name) continue;
        usage.set(mount.Name, [...(usage.get(mount.Name) ?? []), name]);
      }
    }

    return (payload.Volumes ?? [])
      .map<DockerVolume>((item) => ({
        name: item.Name,
        driver: item.Driver ?? "local",
        mountpoint: item.Mountpoint ?? "",
        createdAt: item.CreatedAt ? Math.floor(Date.parse(item.CreatedAt) / 1000) : null,
        usedBy: (usage.get(item.Name) ?? []).sort((a, b) => a.localeCompare(b, "tr")),
        composeProject: item.Labels?.["com.docker.compose.project"] ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  },

  async networks(): Promise<DockerNetwork[]> {
    const [networkResponse, containerResponse] = await Promise.all([
      request("/networks", 10_000),
      request("/containers/json?all=1", 10_000),
    ]);

    const items = expectJson<NetworkPayload[]>(networkResponse);
    const containers = expectJson<ListPayload[]>(containerResponse);

    const attached = new Map<string, string[]>();
    for (const container of containers) {
      const name = (container.Names?.[0] ?? container.Id).replace(/^\//, "");
      for (const network of Object.keys(container.NetworkSettings?.Networks ?? {})) {
        attached.set(network, [...(attached.get(network) ?? []), name]);
      }
    }

    return items
      .map<DockerNetwork>((item) => ({
        id: item.Id,
        name: item.Name,
        driver: item.Driver ?? "",
        scope: item.Scope ?? "",
        builtin: ["bridge", "host", "none"].includes(item.Name),
        subnet: item.IPAM?.Config?.[0]?.Subnet ?? null,
        gateway: item.IPAM?.Config?.[0]?.Gateway ?? null,
        internal: item.Internal === true,
        attachable: item.Attachable === true,
        labels: item.Labels ?? {},
        attached: (attached.get(item.Name) ?? []).sort((a, b) => a.localeCompare(b, "tr")),
        composeProject: item.Labels?.["com.docker.compose.project"] ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  },

  async removeResource(kind, id, force): Promise<void> {
    const path =
      kind === "image"
        ? `/images/${encodeURIComponent(id)}?force=${force ? 1 : 0}`
        : kind === "volume"
          ? `/volumes/${encodeURIComponent(id)}`
          : `/networks/${encodeURIComponent(id)}`;

    const response = await request(path, 30_000, "DELETE");
    if (response.status === 200 || response.status === 204) return;
    throw dockerError(response);
  },

  async setRestartPolicy(id, policy): Promise<void> {
    // `/update` container'ı yeniden oluşturmadan çalışırken de uygular.
    const response = await request(
      `/containers/${encodeURIComponent(id)}/update`,
      10_000,
      "POST",
      {
        RestartPolicy: {
          Name: policy.name,
          MaximumRetryCount: policy.name === "on-failure" ? policy.maximumRetryCount : 0,
        },
      },
    );

    if (response.status !== 200) throw dockerError(response);

    // Docker uyarıları 200 ile birlikte döner; sessizce yutmak yanlış olur.
    const payload = JSON.parse(response.body) as { Warnings?: string[] };
    if (payload.Warnings?.length) throw new Error(payload.Warnings.join(" · "));
  },

  // --- M1.11 ---

  async *pullImage(reference: string): AsyncGenerator<string> {
    const [name, tag] = splitReference(reference);
    const path = `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`;

    // Pull dakikalar sürebilir (Home Assistant image'ı 3 GB) ve Docker
    // ilerlemeyi satır satır JSON olarak akıtır. Yanıtı toptan beklemek,
    // hem zaman aşımına yakalanmak hem de kullanıcıya "dondu mu?" dedirtmek
    // demekti.
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        { socketPath: SOCKET_PATH, path, method: "POST", timeout: 0 },
        resolve,
      );
      req.on("error", reject);
      req.end();
    });

    if (response.statusCode !== 200) {
      let body = "";
      for await (const chunk of response) body += chunk;
      throw dockerError({ status: response.statusCode ?? 0, body });
    }

    let buffer = "";
    for await (const chunk of response) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        const event = JSON.parse(line) as {
          status?: string;
          error?: string;
          progress?: string;
          id?: string;
        };
        // Hata gövdenin İÇİNDE gelir; HTTP durumu yine 200'dür. Bunu
        // yutmak, "güncellendi" deyip aslında eski image'la devam etmek olurdu.
        if (event.error) throw new Error(event.error);
        if (event.status) {
          yield `${event.id ? `${event.id}: ` : ""}${event.status}${event.progress ? ` ${event.progress}` : ""}`;
        }
      }
    }
  },

  async createContainer(name: string, payload: unknown): Promise<string> {
    const response = await request(
      `/containers/create?name=${encodeURIComponent(name)}`,
      30_000,
      "POST",
      payload,
    );

    if (response.status !== 201) throw dockerError(response);
    const data = JSON.parse(response.body) as { Id: string; Warnings?: string[] };
    return data.Id;
  },

  async renameContainer(id: string, name: string): Promise<void> {
    const response = await request(
      `/containers/${encodeURIComponent(id)}/rename?name=${encodeURIComponent(name)}`,
      15_000,
      "POST",
    );
    if (response.status !== 204) throw dockerError(response);
  },

  async removeContainer(id: string, force: boolean): Promise<void> {
    const response = await request(
      `/containers/${encodeURIComponent(id)}?force=${force ? 1 : 0}`,
      60_000,
      "DELETE",
    );
    if (response.status !== 204 && response.status !== 404) throw dockerError(response);
  },

  async connectNetwork(networkId: string, containerId: string, config: unknown): Promise<void> {
    const response = await request(
      `/networks/${encodeURIComponent(networkId)}/connect`,
      15_000,
      "POST",
      { Container: containerId, EndpointConfig: config },
    );
    if (response.status !== 200) throw dockerError(response);
  },

  async runOnce(nameOrId: string, command: string[]) {
    const created = await request(
      `/containers/${encodeURIComponent(nameOrId)}/exec`,
      10_000,
      "POST",
      { AttachStdout: true, AttachStderr: true, Tty: false, Cmd: command },
    );
    if (created.status !== 201) throw dockerError(created);

    const execId = (JSON.parse(created.body) as { Id: string }).Id;

    // `Detach: false` + `Tty: false` → yanıt gövdesi ÇERÇEVELİ akış. Metin
    // olarak okunamaz: çerçeve başlığındaki uzunluk alanı geçerli UTF-8
    // olmayabilir ve decode edilirken bozulur. Bu yüzden ham bayt isteniyor.
    const started = await requestBinary(`/exec/${execId}/start`, 30_000, {
      Detach: false,
      Tty: false,
    });

    const inspected = await request(`/exec/${execId}/json`, 10_000);
    const exitCode =
      inspected.status === 200
        ? ((JSON.parse(inspected.body) as { ExitCode: number | null }).ExitCode ?? -1)
        : -1;

    return { exitCode, output: stripFrames(started) };
  },

  // --- M3.23 ---

  async readContainerArchive(id, path): Promise<Buffer> {
    const query = `?path=${encodeURIComponent(path)}`;
    const result = await requestRawStatus(
      `/containers/${encodeURIComponent(id)}/archive${query}`,
      30_000,
      "GET",
    );

    if (result.status !== 200) {
      // Hata gövdesi JSON; ham tar beklerken metne düşmek gerekiyor.
      throw dockerError({ status: result.status, body: result.body.toString("utf8") });
    }
    return result.body;
  },

  async writeContainerArchive(id, directory, archive): Promise<void> {
    const query = `?path=${encodeURIComponent(directory)}`;
    const result = await requestRawStatus(
      `/containers/${encodeURIComponent(id)}/archive${query}`,
      60_000,
      "PUT",
      archive,
    );

    if (result.status !== 200) {
      throw dockerError({ status: result.status, body: result.body.toString("utf8") });
    }
  },

  // --- M3.24 ---

  async imageHistory(id): Promise<ImageLayer[]> {
    const response = await request(`/images/${encodeURIComponent(id)}/history`, 10_000);
    if (response.status === 404) return [];
    if (response.status !== 200) throw dockerError(response);

    const items = JSON.parse(response.body) as {
      Id?: string;
      Created?: number;
      CreatedBy?: string;
      Size?: number;
      Comment?: string;
    }[];

    return items.map((item) => ({
      id: item.Id ?? "",
      createdAt: item.Created ?? 0,
      // Buildkit satırlarının başındaki gürültüyü atıyoruz; okunan şey
      // Dockerfile komutunun kendisi olmalı.
      createdBy: (item.CreatedBy ?? "").replace(/^\/bin\/sh -c #\(nop\)\s*/, "").trim(),
      sizeBytes: item.Size ?? 0,
      comment: item.Comment ?? "",
    }));
  },

  async inspectImageRaw(id): Promise<unknown | null> {
    const response = await request(`/images/${encodeURIComponent(id)}/json`, 10_000);
    if (response.status === 404) return null;
    if (response.status !== 200) throw dockerError(response);
    return JSON.parse(response.body);
  },

  async inspectVolumeRaw(name): Promise<unknown | null> {
    const response = await request(`/volumes/${encodeURIComponent(name)}`, 10_000);
    if (response.status === 404) return null;
    if (response.status !== 200) throw dockerError(response);
    return JSON.parse(response.body);
  },

  async exportImage(id): Promise<Buffer> {
    // 10 dakika: büyük bir imajın arşivlenmesi diskte gerçek iş demek.
    const result = await requestRawStatus(
      `/images/${encodeURIComponent(id)}/get`,
      600_000,
      "GET",
    );

    if (result.status !== 200) {
      // Hata gövdesi JSON; ham tar beklerken metne düşmek gerekiyor.
      throw dockerError({ status: result.status, body: result.body.toString("utf8") });
    }
    return result.body;
  },

  async createNetwork(spec): Promise<void> {
    /*
      Boş alanlar gövdeye HİÇ yazılmıyor. Docker boş bir `Subnet` ya da
      `Gateway` gördüğünde "invalid CIDR address" ile reddediyor — yani
      doldurulmamış bir alanı boş dize olarak göndermek, kullanıcının
      istemediği bir hatayı üretmek olurdu.
    */
    const ipamConfig: Record<string, string> = {};
    if (spec.subnet) ipamConfig.Subnet = spec.subnet;
    if (spec.gateway) ipamConfig.Gateway = spec.gateway;
    if (spec.ipRange) ipamConfig.IPRange = spec.ipRange;

    const response = await request("/networks/create", 30_000, "POST", {
      Name: spec.name,
      Driver: spec.driver,
      Internal: spec.internal,
      Attachable: spec.attachable,
      Labels: spec.labels,
      CheckDuplicate: true,
      ...(Object.keys(ipamConfig).length > 0 ? { IPAM: { Config: [ipamConfig] } } : {}),
    });

    if (response.status !== 201) throw dockerError(response);
  },

  async disconnectNetwork(networkId, containerId, force): Promise<void> {
    const response = await request(
      `/networks/${encodeURIComponent(networkId)}/disconnect`,
      30_000,
      "POST",
      { Container: containerId, Force: force },
    );
    if (response.status !== 200) throw dockerError(response);
  },

  async createVolume(spec): Promise<void> {
    const response = await request("/volumes/create", 15_000, "POST", {
      Name: spec.name,
      Driver: spec.driver,
      DriverOpts: spec.driverOpts,
      Labels: spec.labels,
    });
    // 201 = yaratıldı. Var olan bir adla çağrılırsa Docker 201 ile MEVCUDU
    // döndürüyor; bu yüzden "zaten var" kontrolü çağıranda yapılıyor.
    if (response.status !== 201) throw dockerError(response);
  },

  async tagImage(source, repo, tag): Promise<void> {
    const query = `?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`;
    const response = await request(
      `/images/${encodeURIComponent(source)}/tag${query}`,
      15_000,
      "POST",
    );
    // 201 = etiketlendi. Docker burada 200 döndürmüyor.
    if (response.status !== 201) throw dockerError(response);
  },

  async diskUsage(): Promise<{ volumeBytes: Record<string, number> }> {
    // 120 sn: Docker her volume'ü yürüyerek ölçüyor; büyük kurulumlarda
    // varsayılan zaman aşımı yetmiyor ve boş sonuç dönmek yerine beklemek yeğ.
    const response = await request("/system/df", 120_000);
    if (response.status !== 200) throw dockerError(response);

    const payload = JSON.parse(response.body) as {
      Volumes?: { Name?: string; UsageData?: { Size?: number } | null }[] | null;
    };

    const volumeBytes: Record<string, number> = {};
    for (const volume of payload.Volumes ?? []) {
      if (!volume.Name) continue;
      // -1 = "Docker hesaplayamadı"; sıfır göstermek yanlış bilgi olurdu.
      const size = volume.UsageData?.Size ?? -1;
      if (size >= 0) volumeBytes[volume.Name] = size;
    }

    return { volumeBytes };
  },

  // --- M3.4 ---

  async runThrowaway(spec): Promise<ExecResult> {
    const name = `${spec.namePrefix}-${randomBytes(4).toString("hex")}`;
    let containerId: string | null = null;

    const payload = {
      Image: spec.image,
      Cmd: spec.cmd,
      Env: Object.entries(spec.env).map(([key, value]) => `${key}=${value}`),
      Tty: false,
      ...(spec.user ? { User: spec.user } : {}),
      HostConfig: {
        Binds: spec.binds,
        // AutoRemove kapalı: container kendini silerse çıkış kodunu ve
        // loglarını okuyamayız — hata durumunda tam olarak ihtiyaç duyulan
        // iki şey bunlar. Silme işini finally bloğu üstleniyor.
        AutoRemove: false,
        NetworkMode: spec.networkMode ?? "bridge",
        ...(spec.pidMode ? { PidMode: spec.pidMode } : {}),
        ...(spec.capAdd?.length ? { CapAdd: spec.capAdd } : {}),
        ...(spec.securityOpt?.length ? { SecurityOpt: spec.securityOpt } : {}),
      },
    };

    const createPath = `/containers/create?name=${encodeURIComponent(name)}`;

    try {
      let created = await request(createPath, 30_000, "POST", payload);

      /*
        İmaj yerelde yoksa Docker 404 döner. Kullanıcıya "önce indir" demek
        yanlış olurdu: bu imajlar panelin kendi araçları (restic, trivy,
        alpine) ve kullanıcının onları yönetmesi beklenmiyor. Bir kez indirilip
        yeniden deneniyor.
      */
      if (created.status === 404) {
        try {
          // İlerleme satırları tüketiliyor; akış bitince indirme tamam.
          const progress = this.pullImage(spec.image);
          while (!(await progress.next()).done) {
            /* ilerleme yok sayılıyor */
          }
        } catch (error) {
          throw new Error(
            `İmaj indirilemedi: ${spec.image} — ${error instanceof Error ? error.message : "?"}`,
          );
        }
        created = await request(createPath, 30_000, "POST", payload);
      }

      if (created.status === 404) {
        throw new Error(`İmaj bulunamadı ve indirilemedi: ${spec.image}`);
      }
      if (created.status !== 201) throw dockerError(created);
      containerId = (JSON.parse(created.body) as { Id: string }).Id;

      const started = await request(
        `/containers/${containerId}/start`,
        30_000,
        "POST",
      );
      if (started.status !== 204 && started.status !== 304) throw dockerError(started);

      const waited = await request(
        `/containers/${containerId}/wait`,
        spec.timeoutMs,
        "POST",
      );
      const exitCode =
        waited.status === 200
          ? Number((JSON.parse(waited.body) as { StatusCode: number }).StatusCode)
          : -1;

      const logs = await requestRawGet(
        // 2000 satır sınırı YOK: Trivy'nin JSON çıktısı bundan uzun olabiliyor
        // ve kırpılmış bir JSON ayrıştırılamaz.
        `/containers/${containerId}/logs?stdout=1&stderr=1`,
        60_000,
      );

      const streams = splitFrames(logs);
      return { exitCode, ...streams };
    } finally {
      if (containerId) {
        // Silme başarısız olsa da asıl sonucu bastırmamalı: yedekleme bitti mi
        // sorusunun cevabı, geride kalan bir container'dan daha önemli.
        try {
          await request(`/containers/${containerId}?force=1&v=1`, 30_000, "DELETE");
        } catch (error) {
          console.error(`[docker] geçici container silinemedi (${name}):`, error);
        }
      }
    }
  },
};

/** Ham bayt döndüren istek — çerçeveli exec çıktısı için (M2.8). */
function requestBinary(path: string, timeoutMs: number, jsonBody: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(jsonBody);
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Docker soketi zaman aşımına uğradı")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Ham bayt döndüren GET — çerçeveli container log çıktısı için (M3.4). */
/**
 * Ham gövde + durum kodu (M3.23).
 *
 * `requestRawGet` durum kodunu yutuyor; tar arşivinde bu kabul edilemez:
 * Docker hata verdiğinde gövde JSON gelir ve onu tar sanıp ayrıştırmak
 * "arşiv boş" gibi yanıltıcı bir sonuç üretir. Ayrıca istek gövdesi
 * gönderilebiliyor — PUT ile arşiv yüklemek için gerekli.
 */
function requestRawStatus(
  path: string,
  timeoutMs: number,
  method: "GET" | "PUT",
  payload?: Buffer,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/x-tar", "content-length": payload.length }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("Docker soketi zaman aşımına uğradı")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestRawGet(path: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCKET_PATH, path, method: "GET", timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Docker soketi zaman aşımına uğradı")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Docker'ın çoklama (multiplexing) çerçevelerini söker.
 *
 * TTY'siz exec çıktısında her parça 8 baytlık bir başlıkla gelir:
 * [akış türü][0][0][0][uzunluk: 4 bayt big-endian]. stdout ve stderr aynı
 * dizede birleştiriliyor — bir hata mesajının hangisinden geldiği kullanıcıyı
 * ilgilendirmiyor, mesajın kendisi ilgilendiriyor.
 */
function stripFrames(raw: Buffer): string {
  return splitFrames(raw).output;
}

/**
 * Çerçeveleri sökerken akışları AYRI da tutar.
 *
 * Çerçeve başlığının ilk baytı akış türü: 1 = stdout, 2 = stderr. JSON üreten
 * araçlarda bu ayrım şart — Trivy günlüğünü stderr'e, sonucu stdout'a yazıyor
 * ve ikisi birleşince çıktı ayrıştırılamıyor (sunucuda yaşandı).
 */
function splitFrames(raw: Buffer): { output: string; stdout: string; stderr: string } {
  const all: Buffer[] = [];
  const outParts: Buffer[] = [];
  const errParts: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= raw.length) {
    const length = raw.readUInt32BE(offset + 4);
    const chunk = raw.subarray(offset + 8, offset + 8 + length);
    all.push(chunk);
    (raw[offset] === 2 ? errParts : outParts).push(chunk);
    offset += 8 + length;
  }

  // Çerçevelenmemiş artık kalırsa atılmıyor: eksik göstermektense ham göster.
  // Hangi akışa ait olduğu bilinmediği için yalnızca birleşik çıktıya girer.
  if (offset < raw.length) all.push(raw.subarray(offset));

  return {
    output: Buffer.concat(all).toString("utf8").trim(),
    stdout: Buffer.concat(outParts).toString("utf8").trim(),
    stderr: Buffer.concat(errParts).toString("utf8").trim(),
  };
}

/** "ghcr.io/a/b:stable" → ["ghcr.io/a/b", "stable"] */
function splitReference(reference: string): [string, string] {
  const colon = reference.lastIndexOf(":");
  if (colon === -1 || reference.slice(colon).includes("/")) return [reference, "latest"];
  return [reference.slice(0, colon), reference.slice(colon + 1)];
}

type ImagePayload = {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
  Created?: number;
  Size?: number;
  /** M3.27: `panel.prune=false` gibi imaj etiketleri. */
  Labels?: Record<string, string> | null;
};

type VolumePayload = {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Labels?: Record<string, string> | null;
};

type NetworkPayload = {
  Id: string;
  Name: string;
  Driver?: string;
  Scope?: string;
  Internal?: boolean;
  Attachable?: boolean;
  Labels?: Record<string, string> | null;
  IPAM?: { Config?: { Subnet?: string; Gateway?: string }[] | null };
};

type DetailPayload = {
  Id: string;
  Name?: string;
  Created?: string;
  RestartCount?: number;
  Image?: string;
  Config?: {
    Image?: string;
    Env?: string[] | null;
    Labels?: Record<string, string> | null;
    Healthcheck?: { Test?: string[] | null; Interval?: number } | null;
  };
  State?: {
    Status?: string;
    StartedAt?: string;
    Health?: {
      Status?: string;
      FailingStreak?: number;
      Log?: { Output?: string }[] | null;
    } | null;
  };
  HostConfig?: {
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    NetworkMode?: string;
    VolumesFrom?: string[] | null;
  };
  Mounts?: {
    Type?: string;
    Name?: string;
    Source?: string;
    Destination?: string;
    RW?: boolean;
  }[];
  NetworkSettings?: {
    Networks?: Record<string, { IPAddress?: string }> | null;
    Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> | null;
  };
};

function toDetail(data: DetailPayload): ContainerDetail {
  const labels = data.Config?.Labels ?? {};
  const health = data.State?.Health;
  const healthcheckTest = data.Config?.Healthcheck?.Test ?? null;

  const ports: ContainerPort[] = [];
  for (const [spec, bindings] of Object.entries(data.NetworkSettings?.Ports ?? {})) {
    const [portPart, protocol] = spec.split("/");
    const containerPort = Number(portPart);
    if (!bindings || bindings.length === 0) {
      ports.push({ hostIp: null, hostPort: null, containerPort, protocol: protocol ?? "tcp" });
      continue;
    }
    for (const binding of bindings) {
      ports.push({
        hostIp: binding.HostIp || null,
        hostPort: binding.HostPort ? Number(binding.HostPort) : null,
        containerPort,
        protocol: protocol ?? "tcp",
      });
    }
  }

  return {
    id: data.Id,
    name: (data.Name ?? data.Id).replace(/^\//, ""),
    image: data.Config?.Image ?? "",
    imageId: data.Image ?? "",
    state: data.State?.Status ?? "bilinmiyor",
    status: data.State?.Status ?? "bilinmiyor",
    health: health?.Status ?? null,
    healthcheck:
      healthcheckTest && healthcheckTest.length > 0
        ? {
            test: healthcheckTest,
            // Docker aralığı nanosaniye tutar.
            intervalSeconds: data.Config?.Healthcheck?.Interval
              ? Math.round(data.Config.Healthcheck.Interval / 1e9)
              : null,
            lastOutput: health?.Log?.at(-1)?.Output?.trim() ?? null,
            failingStreak: health?.FailingStreak ?? 0,
          }
        : null,
    restartPolicy: {
      name: (data.HostConfig?.RestartPolicy?.Name || "no") as RestartPolicy["name"],
      maximumRetryCount: data.HostConfig?.RestartPolicy?.MaximumRetryCount ?? 0,
    },
    restartCount: data.RestartCount ?? 0,
    createdAt: data.Created ? Math.floor(Date.parse(data.Created) / 1000) : 0,
    startedAt: data.State?.StartedAt ?? null,
    ports,
    env: (data.Config?.Env ?? []).map((entry) => {
      const index = entry.indexOf("=");
      return index === -1
        ? { key: entry, value: "" }
        : { key: entry.slice(0, index), value: entry.slice(index + 1) };
    }),
    mounts: (data.Mounts ?? []).map((mount) => ({
      type: mount.Type ?? "",
      source: mount.Source ?? "",
      destination: mount.Destination ?? "",
      readOnly: mount.RW === false,
      volumeName: mount.Name ?? null,
    })),
    networks: Object.keys(data.NetworkSettings?.Networks ?? {}),
    networkMode: data.HostConfig?.NetworkMode ?? "",
    volumesFrom: data.HostConfig?.VolumesFrom ?? [],
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeService: labels["com.docker.compose.service"] ?? null,
  };
}

function toLogLine(stream: string, raw: string): LogLine {
  // Docker "2026-07-25T22:00:00.000000000Z mesaj" biçiminde yazar.
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s([\s\S]*)$/);
  return match
    ? { stream, ts: match[1], text: match[2] }
    : { stream, ts: null, text: raw };
}

// --- Prune -----------------------------------------------------------------

function pruneEndpoint(scope: PruneScope): { path: string; timeout: number } {
  switch (scope) {
    case "containers":
      return { path: "/containers/prune", timeout: 60_000 };
    case "images-dangling":
      return { path: "/images/prune", timeout: 120_000 };
    case "images-unused":
      // dangling=false: yalnızca sarkan değil, hiçbir container'ın kullanmadığı
      // TÜM image'lar. Çok yer açar ama geri almak yeniden indirmek demektir.
      //
      // `label!=panel.prune=false` (M3.27): talep üzerine çekilen ya da
      // derlenen bir imaj, kullanımlar arasında "kullanılmıyor" görünür ve
      // budamada silinir. Etiket onu korur. Süzgeç DAEMON tarafında çalışıyor;
      // Docker 29.0–29.4.0 arası sürümlerde containerd deposu ile bu süzgecin
      // yok sayıldığı bilinen bir hata var (moby#52338, 29.4.1'de düzeldi) —
      // o sürümlerde etiket korumaz, budama hiç bir şey silmeyebilir.
      return {
        path: `/images/prune?filters=${encodeURIComponent(
          '{"dangling":["false"],"label!":["panel.prune=false"]}',
        )}`,
        timeout: 180_000,
      };
    case "volumes":
      return { path: "/volumes/prune", timeout: 60_000 };
    case "networks":
      return { path: "/networks/prune", timeout: 30_000 };
    case "build-cache":
      return { path: "/build/prune", timeout: 120_000 };
  }
}

type PrunePayload = {
  ContainersDeleted?: string[] | null;
  ImagesDeleted?: { Deleted?: string; Untagged?: string }[] | null;
  VolumesDeleted?: string[] | null;
  NetworksDeleted?: string[] | null;
  CachesDeleted?: string[] | null;
  SpaceReclaimed?: number;
};

function parsePrune(scope: PruneScope, data: PrunePayload): PruneResult {
  const items = [
    ...(data.ContainersDeleted ?? []),
    ...(data.ImagesDeleted ?? []).map((i) => i.Untagged ?? i.Deleted ?? "").filter(Boolean),
    ...(data.VolumesDeleted ?? []),
    ...(data.NetworksDeleted ?? []),
    ...(data.CachesDeleted ?? []),
  ];

  return {
    scope,
    removed: items.length,
    reclaimedBytes: data.SpaceReclaimed ?? 0,
    items: items.slice(0, 50),
  };
}

// --- Liste ayrıştırma ------------------------------------------------------

type ListPayload = {
  Id: string;
  Names?: string[];
  Image?: string;
  ImageID?: string;
  State?: string;
  Status?: string;
  Created?: number;
  Ports?: { IP?: string; PrivatePort: number; PublicPort?: number; Type?: string }[];
  Labels?: Record<string, string>;
  /** M1.8: volume ve ağ kullanımını container listesinden çıkarmak için. */
  Mounts?: { Name?: string; Type?: string; Destination?: string }[];
  NetworkSettings?: {
    Networks?: Record<string, { IPAddress?: string } | null> | null;
  };
  /** M3.24: "Ağ modu" sütunu ve ağ haritası için. */
  HostConfig?: { NetworkMode?: string };
};

function toSummary(item: ListPayload): ContainerSummary {
  const labels = item.Labels ?? {};

  // Aynı port birden çok IP ailesinde (IPv4 + IPv6) tekrarlanır; kullanıcıya
  // "8081→80" iki kez göstermenin anlamı yok.
  const seen = new Set<string>();
  const ports: ContainerPort[] = [];
  for (const port of item.Ports ?? []) {
    const key = `${port.PublicPort ?? ""}:${port.PrivatePort}/${port.Type ?? "tcp"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ports.push({
      hostIp: port.IP ?? null,
      hostPort: port.PublicPort ?? null,
      containerPort: port.PrivatePort,
      protocol: port.Type ?? "tcp",
    });
  }

  const status = item.Status ?? "";
  const health = status.match(/\((healthy|unhealthy|health: starting)\)/);

  return {
    id: item.Id,
    name: (item.Names?.[0] ?? item.Id).replace(/^\//, ""),
    image: item.Image ?? "bilinmiyor",
    imageId: item.ImageID ?? "",
    state: item.State ?? "bilinmiyor",
    status,
    health: health ? health[1].replace("health: ", "") : null,
    createdAt: item.Created ?? 0,
    ports,
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeService: labels["com.docker.compose.service"] ?? null,
    labels,
    // `host` ve `none` da birer ağ adı olarak gelir; süzmüyoruz çünkü
    // "hedefle ortak ağ var mı" sorusunun cevabı onlar için de anlamlı:
    // host ağındaki bir container'ın adı hiçbir bridge ağından çözülmez.
    networks: Object.keys(item.NetworkSettings?.Networks ?? {}),
    networkMode: item.HostConfig?.NetworkMode ?? "",
    // İlk boş olmayan IP: bir container birden çok ağdaysa hepsini sütuna
    // sığdırmak mümkün değil, ilki temsil ediyor. Ağ sekmesi tamamını veriyor.
    ipAddress:
      Object.values(item.NetworkSettings?.Networks ?? {})
        .map((entry) => entry?.IPAddress ?? "")
        .find((ip) => ip.length > 0) ?? "",
  };
}

// --- İstatistik ayrıştırma -------------------------------------------------

type StatsPayload = {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number> };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { op?: string; value?: number }[] | null };
};

function parseStats(id: string, data: StatsPayload): ContainerStats {
  const cpuDelta =
    (data.cpu_stats?.cpu_usage?.total_usage ?? 0) -
    (data.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta =
    (data.cpu_stats?.system_cpu_usage ?? 0) - (data.precpu_stats?.system_cpu_usage ?? 0);
  const cpuCount =
    data.cpu_stats?.online_cpus ?? data.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;

  const cpuPct =
    systemDelta > 0 && cpuDelta > 0
      ? Math.min(100 * cpuCount, (cpuDelta / systemDelta) * cpuCount * 100)
      : 0;

  // `docker stats` sayfa önbelleğini kullanımdan düşer; aksi halde dosya okuyan
  // her container belleği doldurmuş gibi görünür.
  const cache =
    data.memory_stats?.stats?.["inactive_file"] ??
    data.memory_stats?.stats?.["total_inactive_file"] ??
    data.memory_stats?.stats?.["cache"] ??
    0;
  const memUsed = Math.max(0, (data.memory_stats?.usage ?? 0) - cache);
  const memLimit = data.memory_stats?.limit ?? 0;

  let netRx = 0;
  let netTx = 0;
  for (const iface of Object.values(data.networks ?? {})) {
    netRx += iface.rx_bytes ?? 0;
    netTx += iface.tx_bytes ?? 0;
  }

  let blockRead = 0;
  let blockWrite = 0;
  for (const entry of data.blkio_stats?.io_service_bytes_recursive ?? []) {
    if (entry.op?.toLowerCase() === "read") blockRead += entry.value ?? 0;
    if (entry.op?.toLowerCase() === "write") blockWrite += entry.value ?? 0;
  }

  return {
    id,
    cpuPct: Number(cpuPct.toFixed(2)),
    memUsed,
    memLimit,
    memPct: memLimit > 0 ? Number(((memUsed / memLimit) * 100).toFixed(2)) : 0,
    netRxBytes: netRx,
    netTxBytes: netTx,
    blockReadBytes: blockRead,
    blockWriteBytes: blockWrite,
  };
}
