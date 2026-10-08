# Docker — /docker
Son güncelleme: 2026-10-08 · commit 428d5e8

## Ne yapar
Panelin en büyük sayfası. Sekmeler: **Container'lar** (liste, kolon seçici, toplu işlem, başlat/durdur/sil, güncelle, oluştur), **Yığınlar** (compose projeleri + uygulama kurulumu — eski App Store buraya taşındı), **Image'lar** (çek, etiketle, dışa aktar, katmanlar), **Volume'ler** (gezin, klonla, dışa aktar), **Ağlar** (topoloji grafiği, bağla/ayır), **Temizlik** (prune). Container detay çekmecesi: genel, kaynaklar (grafik), env, ağ, dosyalar, YAML/compose düzenleme, compose üretme, inspect, loglar (ANSI), terminal, runbook notu.

## Dosyalar
- Sayfa: `src/app/(panel)/docker/page.tsx` — `requirePermission("docker.view")`, `pageHostId({ agent: true })`; `?tab=stack` vb.
- Ekran: `src/app/(panel)/docker/DockerScreen.tsx` (807).
- Bileşenler `src/components/docker/`:
  - Liste: `ContainerRow.tsx` (584), `ColumnPicker`, `BulkBar`, `TabToolbar`, `ContainerDrawer.tsx`
  - Detay `detail/`: `GeneralTab`, `ResourcesTab`, `EnvTab`, `NetworkTab` + `NetworkConnector`, `FilesTab`, `YamlTab`, `GenerateTab`, `InspectTab`, `useDetail.ts`, `shared.tsx`
  - Oluşturma: `ContainerCreateDialog`, `ContainerCreateForm.tsx` (551), `ComposeImportPanel`
  - Yığınlar: `StackPanel.tsx`, `StackInstaller.tsx` (515), `ComposeSection.tsx` (977), `Markdown.tsx`
  - Kaynaklar: `ResourcePanels.tsx` (643), `ResourceDetail.tsx`, `ImagePanel`, `ImagePullPanel`, `ImageLayers`, `VolumeBrowser`, `NetworkPanel.tsx` (807), `NetworkGraph`, `PrunePanel`
  - `LogViewer.tsx`, `TerminalPane.tsx`
- API `src/app/api/docker/` (hepsi `{ agent: true }`):
  - `route.ts` GET liste (`docker.view`); `stacks` GET; `resources` GET/POST; `create`, `from-compose`, `prune`, `pull` POST (`docker.action`)
  - `[id]/action`, `remove`, `restart-policy`, `runbook`, `update` (`docker.action`); `[id]/detail`, `logs` (`docker.view`); `[id]/files` GET/PUT; `[id]/compose` GET/POST; `[id]/compose/generate`; `[id]/terminal` POST (`docker.exec`)
  - Terminal oturumu: `src/app/api/terminal/[session]/route.ts` GET (SSE)/POST/DELETE — `docker.exec`
  - Diğer: `api/appstore` (kurulum), `api/host/compose`, `api/ports`, `api/metrics/series`
- lib `src/lib/docker/`: `view.ts` (liste modeli: canlı liste + `metrics_raw`'dan ölçüm), `collect.ts` (container metrikleri `metrics_raw`'a, label=ad), `update.ts` (tek-tık güncelleme = yeniden yarat), `inherit.ts`, `create.ts` + `spec.ts`, `exec.ts` (terminal; WebSocket yok → SSE + POST), `files.ts` + `tar.ts` + `listing.ts` (container içi dosya; ROOT eşdeğeri), `graph.ts`, `netgraph.ts`, `images.ts`, `layers.ts`, `reference.ts`, `volumes.ts`, `stacks.ts`, `labels.ts` (opt-out etiketler), `runbooks.ts`, `types.ts`.
- lib `src/lib/compose/`: `edit.ts` (oku→doğrula→yaz→uygula), `generate.ts` (container'dan compose), `locate.ts` (compose dosyasını Docker etiketlerinden bul), `replace.ts`, `checks.ts`, `ports.ts`, `service.ts` (yorumları koruyan `yaml` Document API).
- Diğer: `src/lib/appstore/{install,preflight}.ts`, `src/lib/updates/{images,index,normalize}.ts` (digest karşılaştırmalı güncelleme kontrolü), `src/lib/logs/ansi.ts`, `src/lib/metrics/rates.ts`.
- Sağlayıcı: `src/lib/providers/docker.{live,mock}.ts`, arayüz `providers/types.ts` (`DockerProvider`; `runOnce`, `runThrowaway`, `runThrowawayStream`, `connectNetwork` …).
- Tablolar: `runbooks` (`007`), `app_stacks` (`018`), ölçümler `metrics_raw`.
- Ajan op'ları: `docker.<metot>` (`DOCKER_CALLS` / `DOCKER_STREAMS`, `src/lib/agent/protocol.ts`), terminal `exec.start/input/resize/close/output`, compose için `helper.call`.
- Locale: `docker.*` (çok büyük; `docker.network`, `docker.compose`, `docker.create` …).

## Çoklu sunucu
`getDockerProvider()` seçili sunucuya göre yerel ya da `remoteProviders(host)` döner; çağıran fark etmez. Yeni bir Docker metodu uzakta da çalışsın diye `DOCKER_CALLS`/`DOCKER_STREAMS`'e eklenmeli. Port linkleri uzakta `host.address` kullanır.

## Önemli kararlar ve tuzaklar
- Docker'da "güncelle" yok: çek → durdur → yeniden adlandır → aynı spec ile yarat → başarısızsa geri al (`update.ts`).
- Güncelleme kontrolü `docker pull` DEĞİL, manifest digest karşılaştırması (3 GB imajı indirmemek için).
- `ExecResult.stdout` ayrı tutulur (Trivy dersi); `runOnce` artık `{env, user, timeoutMs}` alır (veritabanı envanteri için).
- Compose işlemleri host-helper ile (`docker compose` CLI eklentisi imajda yok).
- Container içi dosya erişimi root'a eşdeğer → `docker.action`/`docker.view` izinleri dikkatle.
