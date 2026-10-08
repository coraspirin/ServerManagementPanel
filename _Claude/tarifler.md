# Tarifler — sık yapılan değişiklikler adım adım
Son güncelleme: 2026-10-09

Her tarifin sonunda: `npm run typecheck && npm run lint && npm test && npm run i18n:check && npm run i18n:scan` + ilgili `_Claude/<sayfa>.md` ve `memory.md` güncellemesi.

## Yeni panel sayfası
1. `src/app/(panel)/<ad>/page.tsx` — sunucu bileşeni: `requirePermission("x.y")` (`@/lib/auth/guard`); çoklu sunucuda çalışacaksa `enterHost(await pageHostId({ agent: true }))` (`@/lib/hosts/request`, `@/lib/hosts/context`); ilk veriyi oku, `<AdScreen initial=… canWrite=…/>`.
2. `src/app/(panel)/<ad>/<Ad>Screen.tsx` — `"use client"`; metin `useT()`, biçim `useFormat()`; API çağrıları `fetch` + CSRF başlığı (örnek `src/app/(panel)/database/api.ts`). Host başlığını genel fetch sarmalayıcısı ekler.
3. Menü: `src/lib/nav.ts` → ilgili gruba `{ href, labelKey: "nav.items.<ad>", icon, permission }`; yalnız yerelse `localOnly: true`.
4. Locale: `nav.items.<ad>`, ekran metinleri `<ad>Screen.*`, yardım `help./<ad>.amac|nasil|dikkat` (`src/lib/help.ts`).
5. `_Claude/<ad>.md` oluştur, `_Claude/README.md` tablosuna ekle.

## Yeni API ucu
1. `src/app/api/<yol>/route.ts`, `export const dynamic = "force-dynamic"`.
2. Girişte: `const guard = await guardHostApi(request, "<izin>", { agent: true })` (merkezi uçsa `guardApi`), `if (!guard.ok) return guard.response; enterHost(guard.hostId);`.
3. Gövde: `try { body = await request.json() } catch { 400 api.invalidRequest }`; kullanıcıya dönen metin `serverT()`.
4. Yazma işleminde `audit({ userId, username, action, targetType, targetId, detail, result })` — gizli değer `detail`'e yazılmaz.
5. Uç `/api/v1/**` ise `docs/openapi.yaml` + `docs/API.md` + `npm run check:openapi`.

## Host dosya sistemine dokunan iş (ajan op'u)
1. Mantığı `localXxx()` olarak yaz (`/host/root` = `process.env.HOST_ROOT ?? "/host/root"`).
2. Dışa açık sarmalayıcı: `export function xxx() { return onHost("alan.ad", [args], () => localXxx(args)); }` (`@/lib/hosts/on-host`).
3. `src/lib/agent/ops.ts` → `AGENT_OPS`'a `"alan.ad": { kind: "call", run: (args) => localXxx(...) }` (akış için `kind: "stream"`).
4. Eski ajanlar `unknown-op:alan.ad` döner → çağıranda yakala, "ajanı güncelle" mesajı (örnek: `src/lib/dbadmin/exec/inventory.ts` → `dbadmin.agentOutdated`).
5. Ajanlara ulaşması için sürüm yayınla (`surum-deploy.md`). Op adı bir kez yayınlandıktan sonra değiştirme.

## Docker sağlayıcısına yeni metot
1. `src/lib/providers/types.ts` → `DockerProvider` arayüzü (+ gerekli tipler).
2. `src/lib/providers/docker.live.ts` (Engine API, `request`/`requestBinary`/`openStream`) ve `docker.mock.ts`.
3. Uzakta çalışsın: `src/lib/agent/protocol.ts` → `DOCKER_CALLS` (ya da akışsa `DOCKER_STREAMS`); `remote.ts` genelde değişmez (uzun süreliyse zaman aşımı `agent/client.ts`).
4. Var olan metoda opsiyonel parametre eklemek geriye uyumlu ama eski ajan yok sayar → yeni alanın gelmediğini tespit et (örnek: `runOnce` `{env}` + `ExecResult.stdout` kontrolü, `dbadmin/exec/runner.ts`).
5. Protokol kırılıyorsa `AGENT_PROTOCOL`'ü artır (eski ajanlar "uyumsuz" olur).

## Migration
1. `src/lib/db/migrations/NNN_ad.ts` → `export const migrationNNN: Migration = { version: NNN, name: "ad", up: \`…SQL…\` }`; başına NEDEN yorumu.
2. `index.ts`'e import + diziye ekle (sıra boşluksuz).
3. UNIQUE kaldırmak / FK'li tabloyu yeniden kurmak tehlikeli (bkz. `veritabani-sema.md` → Tuzaklar). Sunucuya özgü tabloya `host_id INTEGER NOT NULL DEFAULT 1` + indeks.
4. Bellekte dene (`test-dogrulama.md` §6); `veritabani-sema.md`'yi güncelle.

## Ayar
1. `src/settings.schema.ts` → `{ key: "alan.ad", group, section, type, default, min, max }` (grup listesi aynı dosyada `settingGroups`).
2. Locale: `settings.*` altında etiket/açıklama (mevcut bir ayarın anahtarlarını örnek al).
3. Kodda `getNumber/getBool/getString("alan.ad")` (`@/lib/settings`). Eşik/aralık/limit/sıklık koda sabit yazılmaz.

## İzin (permission)
1. `src/lib/auth/types.ts` → `PermissionKey` birleşimine ekle.
2. Migration: `INSERT INTO permissions (key, description)` + varsayılan rollere `INSERT INTO role_permissions` (örnek `013_users.ts`).
3. Kullanıcılar ekranındaki grup eşlemesi (`UsersScreen.tsx` `users.group.*`) ve locale etiketi.
4. Token'a hiç verilmemesi gereken izinse `src/lib/apiv1/guard.ts` → `TOKEN_FORBIDDEN`; riskli olarak işaretlenecekse locale `account.tokens.risky.<izin>`.

## Locale anahtarı
- `src/locales/tr.json` KAYNAK; `en.json`, `de.json`'a da aynı anahtar. Dosyalar düz anahtarlı, aynı önekli son anahtarın ARKASINA ekle; JSON'u `indent=2`, `ensure_ascii=False`, sonda `\n` ile yaz.
- Sunucu `serverT("a.b", { x })`, istemci `t("a.b", { x })`; biçimli parça için `<Rich text=… values=…/>`.
- Kodda sabit Türkçe metin bırakma; protokol metniyse satır sonuna `// i18n-ignore`.

## Gösterge paneli widget'ı
1. `src/lib/dashboard/catalog.ts` → `WIDGETS`'a `{ key, permission?, visible, size }`.
2. Bileşen `src/components/home/widgets/<Ad>.tsx` + `dashboard.tsx`'te key → bileşen eşlemesi; veri `src/lib/dashboard/summary.ts`.
3. Locale `dashboard.widget.<key>.label|description`.

## Arka plan işi (job)
1. `src/lib/jobs/definitions.ts` → `jobDefinitions`'a `{ key, schedule: { kind: "interval", settingKey } | { kind: "fixed", seconds, labelKey }, leaseSeconds, scope: "perHost", run: perHost(async () => ({ detail })) }`.
2. Locale `jobs.items.<key>.label|description`.

## host-helper eylemi
Bkz. `host-helper.md` → "Yeni eylem eklerken" (helper `ACTIONS` + doğrulayıcı, panel çağrısı, sunucuda `allow.conf`).

## Servis widget'ı (uygulama kartı)
`src/lib/widgets/<servis>.ts` (veriyi panel biçiminde döndür: istatistik + satır) + `src/lib/widgets/index.ts` kaydı; örnek `pihole.ts`.
