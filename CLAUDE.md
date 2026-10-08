# Sunucu Yönetim Paneli

Bir panel sayfası üzerinde çalışmadan önce `_Claude/README.md` (ortak altyapı + dizin) ve ilgili `_Claude/<sayfa>.md` dosyasını oku; kodu baştan tarama. Sayfa dosyası ilgili dosyaları, API uçlarını, izinleri, tabloları, ajan op'larını ve tasarım kararlarını listeler.

Bir sayfanın kodunu değiştirdiğinde ilgili `_Claude/<sayfa>.md`'yi de güncelle (yeni dosya/uç/tablo, değişen karar, "Son güncelleme" satırı).

İşe başlarken `_Claude/memory.md`'nin son kayıtlarına ve `_Claude/yapilacaklar.md`'ye bak. Bir tasarımı değiştirmeden önce `_Claude/kararlar.md`'yi oku (oradaki kararlar kullanıcıya sorulmadan geri alınmaz). Yeni sayfa/uç/op/migration/ayar eklerken `_Claude/tarifler.md`, sürüm ve dağıtım için `_Claude/surum-deploy.md`, test için `_Claude/test-dogrulama.md`. Açık bir iş bitince `yapilacaklar.md`'den düş; yeni bir karar alınınca `kararlar.md`'ye ekle.

Her işlemden sonra (kod değişikliği, düzeltme, deploy, sunucuda yapılan iş, commit/sürüm) `_Claude/memory.md`'nin en üstüne tarih damgalı bir kayıt ekle — saat için `date "+%Y-%m-%d %H:%M"`. Biçim dosyanın başında. Yeni bir oturuma başlarken son kayıtları oku.

Kullanıcıyla Türkçe konuş; kod yorumları ve `src/locales/tr.json` Türkçe kaynaktır.
