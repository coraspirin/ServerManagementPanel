# Sunucular — /hosts
Son güncelleme: 2026-10-13 · boş başlangıç (D1) + yetki yoklaması + docker.api tüneli (commit edilmedi)

## Ne yapar
Çoklu sunucu yönetimi: panel-agent'lı uzak sunucu ekleme sihirbazı (kurulum kiti + kayıt), durum (çevrimiçi/çevrimdışı/uyumsuz), yeniden adlandırma/silme, token yenileme, ajan sürümü ve uzaktan güncelleme ("hepsini güncelle"). `/hosts/unavailable`: seçili sunucuya ulaşılamadığında yönlendirilen bilgi sayfası. `/ilk-sunucu`: etkin hiç sunucu yokken "İlk sunucunu ekle" (D1). Satırlarda **yetki yoklaması** (✅/🟡/🔴 özet + "Özellikler" penceresi, düzeltme komutlarıyla). Yerel sunucu artık aç/kapat düğmesine sahip (silinemez).

## Dosyalar
- Sayfalar: `src/app/(panel)/hosts/page.tsx` (`hosts.view`; `?ekle=1` ekleme sihirbazını açar), `src/app/(panel)/hosts/unavailable/page.tsx` (oturum yeter), `src/app/(panel)/ilk-sunucu/page.tsx` (oturum yeter; sunucu varsa `/panel`'e döner, yerel otomatik kapatıldıysa compose mount satırlarını gösterir).
- Ekran: `src/app/(panel)/hosts/HostsScreen.tsx` (676) — liste, ekleme sihirbazı, güncelleme rozeti/diyaloğu.
- Üst çubuktaki sunucu seçici: `src/components/shell/HostContext.tsx` (+ HostSelector).
- API:
  - `src/app/api/hosts/route.ts` GET (`hosts.view`), POST (`hosts.manage`)
  - `src/app/api/hosts/[id]/route.ts` PATCH, DELETE; `[id]/enroll` POST; `[id]/token` POST — `hosts.manage`
  - `src/app/api/hosts/[id]/update/route.ts` GET, POST — `panel.update`
  - Ajan tarafı uçlar: `src/app/api/agent/{rpc,stream,enroll}/route.ts`
- lib:
  - `src/lib/hosts/local-probe.ts` (saf: `decideLocal`, `probeLocalMounts`, `localMountPaths`), `local-state.ts` (`applyLocalProbe` — açılışta; `localAutoDisabled`, `clearLocalAutoDisabled`; işaret `cache` `hosts:local-auto-disabled`).
  - `src/lib/permissions/features.server.ts` (`hostFeatures` — yoklama; yerelde mount'lar + `HELPER_SECRET`, ajanda hello capabilities, `proc` = `hostRoot` varsayılır), katalog `src/lib/permissions/catalog.ts`. `HostView.features` yalnız liste ekranında/`GET /api/hosts`'ta dolu.
  - `src/lib/hosts/store.ts` (hosts tablosu), `agents.ts` (oluştur/kayıt/heartbeat, ajan compose üretimi, otomatik güncelleme), `context.ts` (`runWithHost`/`currentHostId`), `request.ts` + `resolve.ts` (istekten sunucu seçimi), `on-host.ts` (`onHost`), `fanout.ts`, `mock.ts`, `view.ts`, `errors.ts` (`HostError`).
  - `src/lib/agent/protocol.ts` (`AGENT_PROTOCOL`, imza, `DOCKER_CALLS`/`DOCKER_STREAMS`, `docker.api` tel tipleri), `docker-api-policy.ts` (tünelin kapalı izin listesi, saf), ortak test vektörleri `protocol/vectors-v3.json` (`npm run protocol:vectors`, `vectors.test.ts`), `client.ts` (`agentCall`/`agentStream`), `server.ts` (`handleRpc`), `ops.ts` (`AGENT_OPS` kaydı), `identity.ts`.
  - `src/lib/selfupdate/*` — `agent.update` / `agent.updateStatus` op'ları aynı updater'ı ajanda çalıştırır.
- Tablo: `hosts` (`001_foundation.ts`, `026_multi_host.ts`).
- Ayar: `agents.auto_update` (varsayılan açık; heartbeat'te merkez sürümüne, etiket başına bir kez).
- Locale: `hosts.*`.

## Çoklu sunucu mimarisi (özet)
- Aynı Docker imajı `PANEL_ROLE=agent` ile ajan olur; merkez ↔ ajan imzalı RPC (TLS, `scripts/docker-entry.mjs` sertifika üretir).
- Seçim önceliği: `x-panel-host` başlığı > `?host=` > `panel_host` çerezi > **varsayılan sunucu** (`defaultHostId`: listedeki ilk etkin sunucu; yerel etkinse yerel). Etkin sunucu yoksa `pickHost` → `{ ok: false, reason: "none" }`: API 409 `{ code: "noHost", hint }`, sayfalar `/ilk-sunucu`'ya (layout tam yüklemede `x-panel-path` başlığıyla, `pageHostId`/`withPageHost`/`requireLocalPage` her sayfada). Muaf yollar `layout.tsx` `NO_HOST_PATHS`.
- Bağlamsız `currentHostId()`: merkezde `instrumentation.ts` `setDefaultHostResolver` kaydeder (`globalThis`'te — Next modülü çoğaltabiliyor); sunucu yoksa `HostError("noHost")`. Ajan sürecinde/testlerde çözücü yok → 1. Fırlatmaması gereken yerler `currentHostIdOrNull()` (ayarlar, bildirim) ya da `contextHostId()` (denetim kaydı: bağlam yoksa 1 = "panelin kendisi").
- Yalnız yerel merkezi işler (`network.scan`, `network.speedtest`, `security.vuln_scan`, `security.upnp_scan`, `mqtt.publish`) `jobs/definitions.ts` `LOCAL_ONLY_JOBS` ile açıkça yerel bağlamda çalışır; yerel kapalıysa atlanır. İstemcide `src/lib/client/host.ts` her `/api/` fetch'ine başlığı ekler; indirme linkleri için `withHostQuery()`.
- Uçlar ajan sunucusunda varsayılan 501; taşınanlar `guardHostApi(req, perm, { agent: true })`, sayfalar `pageHostId({ agent: true })`. Yalnız yerel özellikler `{ localOnly: true }`.
- Host dosya sistemine dokunan iş: `onHost("op.adı", args, localFn)` + `ops.ts`'e kayıt. Docker işleri `getDockerProvider()` üzerinden kendiliğinden yönlenir.
- **Uzak Docker yolu (K2)**: `remoteDockerMode(host)` (`src/lib/docker/transport.remote.ts`) — `rpc` = ajandaki sağlayıcı (`docker.list`…), `api` = merkezdeki `liveDockerProvider` ajanın `docker.api`/`docker.apiStream` tüneline bağlanır (`providersFor`, olay izleyicisi `watchRemote`). Native ajan (`capabilities.dockerRpc: false`) her zaman api; Node ajanında varsayılan rpc, ayar `agents.docker_transport` (sunucuya özel) `api` ile tünel. Etkileşimli terminal her iki modda `exec.*` op'ları.

## Önemli kararlar ve tuzaklar
- **Yerel isteğe bağlı (D1, 2026-10-13)**: açılışta docker.sock, /host/proc, /host/root'un ÜÇÜ DE yoksa yerel `enabled=0` + işaret; mount'lar gelince yalnız işaretliyse yeniden açılır. Kullanıcı `/hosts`'ta yereli aç/kapatınca işaret silinir. Mount'lar yokken yereli açmak 400 `hosts.validation.localNoMounts` (MOCK_MODE hariç). Yerel kapalıyken `providersFor(1)` `HostError` fırlatır; self-update `localProviders()` ile kendi container'ına erişmeye devam eder. MOCK_MODE'da yoklama yok.
- Kullanıcının ajanı: 192.168.61.107 (DietPi, armv7, root, `/root/panel-agent`). 2026-10-14'ten beri `AGENT_IMAGE=panel-agent-local:1.13.1` (yayınsız yerel imaj, bkz. `surum-deploy.md`); bu bilgisayardan `ssh root@192.168.61.107` anahtarla açık. Elle dağıtım: repo kökünde `agent-deploy.py <IP…>`.
- Ajan güncellemesi için önce sürüm etiketi + GHCR imajı yayımlanmış olmalı (`docker-publish.yml`, amd64/arm64/arm/v7).
- Yeni ajan op'u eklenince eski ajanlar `unknown-op:<ad>` döner — çağıran taraf bunu "ajanı güncelle" mesajına çevirmeli.
