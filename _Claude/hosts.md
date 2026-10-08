# Sunucular — /hosts
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Çoklu sunucu yönetimi: panel-agent'lı uzak sunucu ekleme sihirbazı (kurulum kiti + kayıt), durum (çevrimiçi/çevrimdışı/uyumsuz), yeniden adlandırma/silme, token yenileme, ajan sürümü ve uzaktan güncelleme ("hepsini güncelle"). `/hosts/unavailable`: seçili sunucuya ulaşılamadığında yönlendirilen bilgi sayfası.

## Dosyalar
- Sayfalar: `src/app/(panel)/hosts/page.tsx` (`hosts.view`), `src/app/(panel)/hosts/unavailable/page.tsx` (oturum yeter).
- Ekran: `src/app/(panel)/hosts/HostsScreen.tsx` (676) — liste, ekleme sihirbazı, güncelleme rozeti/diyaloğu.
- Üst çubuktaki sunucu seçici: `src/components/shell/HostContext.tsx` (+ HostSelector).
- API:
  - `src/app/api/hosts/route.ts` GET (`hosts.view`), POST (`hosts.manage`)
  - `src/app/api/hosts/[id]/route.ts` PATCH, DELETE; `[id]/enroll` POST; `[id]/token` POST — `hosts.manage`
  - `src/app/api/hosts/[id]/update/route.ts` GET, POST — `panel.update`
  - Ajan tarafı uçlar: `src/app/api/agent/{rpc,stream,enroll}/route.ts`
- lib:
  - `src/lib/hosts/store.ts` (hosts tablosu), `agents.ts` (oluştur/kayıt/heartbeat, ajan compose üretimi, otomatik güncelleme), `context.ts` (`runWithHost`/`currentHostId`), `request.ts` + `resolve.ts` (istekten sunucu seçimi), `on-host.ts` (`onHost`), `fanout.ts`, `mock.ts`, `view.ts`, `errors.ts` (`HostError`).
  - `src/lib/agent/protocol.ts` (`AGENT_PROTOCOL`, imza, `DOCKER_CALLS`/`DOCKER_STREAMS`), `client.ts` (`agentCall`/`agentStream`), `server.ts` (`handleRpc`), `ops.ts` (`AGENT_OPS` kaydı), `identity.ts`.
  - `src/lib/selfupdate/*` — `agent.update` / `agent.updateStatus` op'ları aynı updater'ı ajanda çalıştırır.
- Tablo: `hosts` (`001_foundation.ts`, `026_multi_host.ts`).
- Ayar: `agents.auto_update` (varsayılan açık; heartbeat'te merkez sürümüne, etiket başına bir kez).
- Locale: `hosts.*`.

## Çoklu sunucu mimarisi (özet)
- Aynı Docker imajı `PANEL_ROLE=agent` ile ajan olur; merkez ↔ ajan imzalı RPC (TLS, `scripts/docker-entry.mjs` sertifika üretir).
- Seçim önceliği: `x-panel-host` başlığı > `?host=` > `panel_host` çerezi > yerel. İstemcide `src/lib/client/host.ts` her `/api/` fetch'ine başlığı ekler; indirme linkleri için `withHostQuery()`.
- Uçlar ajan sunucusunda varsayılan 501; taşınanlar `guardHostApi(req, perm, { agent: true })`, sayfalar `pageHostId({ agent: true })`. Yalnız yerel özellikler `{ localOnly: true }`.
- Host dosya sistemine dokunan iş: `onHost("op.adı", args, localFn)` + `ops.ts`'e kayıt. Docker işleri `getDockerProvider()` üzerinden kendiliğinden yönlenir.

## Önemli kararlar ve tuzaklar
- Kullanıcının ajanı: 192.168.61.107 (DietPi, armv7, root, `/root/panel-agent`). Elle dağıtım: repo kökünde `agent-deploy.py <IP…>`.
- Ajan güncellemesi için önce sürüm etiketi + GHCR imajı yayımlanmış olmalı (`docker-publish.yml`, amd64/arm64/arm/v7).
- Yeni ajan op'u eklenince eski ajanlar `unknown-op:<ad>` döner — çağıran taraf bunu "ajanı güncelle" mesajına çevirmeli.
