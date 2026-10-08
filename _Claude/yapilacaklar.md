# Yapılacaklar ve açık konular
Son güncelleme: 2026-10-09

Kural: biten maddeyi sil (ya da "Kapananlar"a taşı) ve `memory.md`'ye kayıt düş. Yeni açık iş / bilinen hata buraya eklenir. Bir madde ile çalışmadan önce burada ve ilgili sayfa rehberinde güncel durumu kontrol et.

## Commit / dağıtım bekleyenler
- [ ] **Veritabanı envanteri** (2026-10-08/09, `database.md`) — commit edilmedi, sunucuya deploy edilmedi. Deploy sonrası doğrulanacak: Docker DB'leri (paperless-db postgres, paperless-redis) listede ve boyutlu; SQLite grupları (defterim, vaultwarden, pihole…); tablo gezme, sorgu; test DB oluştur → kullanıcı + salt-okunur yetki → dump (`gunzip` ile kontrol) → sil.
- [ ] **Sayfa rehberleri + `CLAUDE.md` + `_Claude/`** — commit edilmedi.
- [ ] **Yeni sürüm yayınlama** — ajanlarda envanterin çalışması için gerekli (`runOnce` env seçeneği, `db.native` op'u, imajdaki DB istemcileri). Bkz. `surum-deploy.md`.

## Doğrulanmamış özellikler
- [ ] **Yedekleme v2** (`backup.md`): sunucuda gerçek restic koşusu (yedekle → geri yükle → doğrulama) yapılmadı; yalnız MOCK_MODE'da ekran testi.
- [ ] **Ajanın kendini güncellemesi** (`hosts.md`, commit 428d5e8): uçtan uca denenmedi (panelden `agent.update` → ajan GHCR'den çeker → yeniden başlar). Eski ajanlar bir kez elle güncellenmeli (`agent-deploy.py`).
- [ ] **Uzak ajanda (192.168.61.107, armv7) veritabanı sayfası** — yeni sürümden sonra.

## Eksik / yarım işler
- [ ] **Yedekleme**: "ilk kurulumda yedekten geri yükle" (v2 planındaki ek #6) yapılmadı. İndirme yalnız yerel sunucuda.
- [ ] **Çoklu sunucu P7**: v1 API (`src/app/api/v1/**`) host seçimini (`?host=`) desteklemiyor — yalnız yerel sunucu; `docs/API.md` güncellenmeli.
- [ ] **SQLite dosyaları**: döküm/indirme yok (yalnız sunucu motorlarında).

## Bilinen sınırlamalar / hatalar
- Native PostgreSQL ≥16 dökümü başarısız: panel imajındaki `pg_dump` 15 (Debian bookworm). Çözüm seçeneği: PGDG deposundan `postgresql-client-17` (armhf desteği kontrol edilmeli).
- `next build` uyarısı: `src/instrumentation.ts:33` `node:crypto` Edge runtime uyarısı — derlemeyi durdurmuyor, önceden var.
- Uzak sunucuda "Sunucu" sayfası (`host.md`) için o sunucuda host-helper + `HELPER_SECRET` kurulu olmalı.
- `/home/coraspirin` 750 → panel (uid 1001) bazı yolları yalnız yükseltilmiş okumayla görür (normal, bkz. `files.md`).

## Kapananlar
(henüz yok)
