/**
 * Ayarların adları, yardım metinleri, birimleri ve enum seçenek adları.
 *
 * Anahtarlar `settings.schema.ts`teki ayar anahtarlarıyla BİREBİR aynı.
 * Bu dosya şemadan üretildi; yeni ayar eklerken buraya da bir satır
 * eklenir — `settings-coverage.test.ts` eksik kalanı söyler.
 */

export const settingItems = {
  "general.language": {
    label: "Dil",
    help: "Panelin arayüz dili. Değiştirildiğinde sayfa yeniden yüklenir; ayar tüm kullanıcılar için ortaktır.",
    options: {
      "tr": "Türkçe",
      "en": "English",
    },
  },
  "general.theme": {
    label: "Tema",
    options: {
      "system": "Sistem",
      "light": "Açık",
      "dark": "Koyu",
    },
  },
  "general.timezone": {
    label: "Saat dilimi",
    help: "Zaman damgalarının gösteriminde kullanılır.",
  },
  "general.ui_refresh_interval": {
    label: "Arayüz yenileme aralığı",
    help: "Canlı kartların kendini ne sıklıkla tazeleyeceği.",
    unit: "sn",
  },
  "monitoring.collect_interval": {
    label: "Metrik toplama aralığı",
    help: "Ham metriklerin çözünürlüğü. Büyütmek veritabanı yükünü azaltır.",
    unit: "sn",
  },
  "monitoring.retention.raw_hours": {
    label: "Ham metrik saklama",
    help: "Bu süreden eski ham örnekler budanır (rollup'lar korunur).",
    unit: "saat",
  },
  "monitoring.retention.minute_days": {
    label: "1 dakikalık metrik saklama",
    unit: "gün",
  },
  "monitoring.retention.hour_days": {
    label: "1 saatlik metrik saklama",
    unit: "gün",
  },
  "monitoring.retention.day_months": {
    label: "Günlük metrik saklama",
    help: "İzleme raporlarının kaç ay geriye gideceğini belirler.",
    unit: "ay",
  },
  "monitoring.rollup_cron": {
    label: "Rollup/budama sıklığı",
    help: "Ham veriyi katmanlara toplayan ve eskiyi budayan işin çalışma sıklığı.",
  },
  "monitoring.disks": {
    label: "İzlenecek disk bölümleri",
    help: "Virgülle ayrılmış bağlama noktaları (ör. /, /mnt/veri). Boş bırakılırsa gerçek dosya sistemleri kendiliğinden bulunur.",
  },
  "monitoring.net_interfaces": {
    label: "İzlenecek ağ arayüzleri",
    help: "Virgülle ayrılmış arayüz adları (ör. enp3s0). Boş bırakılırsa yalnızca fiziksel arayüzler izlenir; docker/veth köprüleri sayılmaz.",
  },
  "monitoring.chart_default_range": {
    label: "Grafiklerin açılış aralığı",
    options: {
      "1h": "Son 1 saat",
      "6h": "Son 6 saat",
      "24h": "Son 24 saat",
      "7d": "Son 7 gün",
      "30d": "Son 30 gün",
      "1y": "Son 1 yıl",
    },
  },
  "health.interval": {
    label: "Kontrol aralığı",
    help: "Bir monitör kendi aralığını tanımlamadıysa bu kullanılır.",
    unit: "sn",
  },
  "health.timeout": {
    label: "Zaman aşımı",
    unit: "sn",
  },
  "health.retries": {
    label: "Tek turda yeniden deneme",
    help: "Anlık bir ağ hıçkırığı servisi düşmüş göstermesin diye aynı tur içinde tekrar denenir.",
  },
  "health.down_threshold": {
    label: "Kaç ardışık başarısızlıkta 'çevrimdışı'",
    help: "Flap eden servis tek bir hatada çevrimdışı sayılmasın (M1.3'te bildirim de buna bağlı).",
  },
  "health.uptime_retention_months": {
    label: "Uptime geçmişi saklama",
    unit: "ay",
  },
  "alerts.cpu.warn": {
    label: "İşlemci — uyarı eşiği",
    unit: "%",
  },
  "alerts.cpu.crit": {
    label: "İşlemci — kritik eşik",
    unit: "%",
  },
  "alerts.ram.warn": {
    label: "Bellek — uyarı eşiği",
    unit: "%",
  },
  "alerts.ram.crit": {
    label: "Bellek — kritik eşik",
    unit: "%",
  },
  "alerts.disk.warn": {
    label: "Disk — uyarı eşiği",
    help: "İleride disk bazında ezilebilecek; şimdilik tüm bölümlere uygulanır.",
    unit: "%",
  },
  "alerts.disk.crit": {
    label: "Disk — kritik eşik",
    unit: "%",
  },
  "docker.stats_interval": {
    label: "Container ölçüm aralığı",
    help: "Docker'ın /stats çağrısı container başına ~1 saniye sürer; çok sık ölçmek sunucuyu meşgul eder.",
    unit: "sn",
  },
  "docker.restart_loop.window": {
    label: "Restart-loop penceresi",
    help: "Bu süre içindeki yeniden başlatmalar sayılır.",
    unit: "dk",
  },
  "docker.restart_loop.threshold": {
    label: "Restart-loop eşiği",
    help: "Pencere içinde bu kadar yeniden başlatma olursa alarm üretir. Container 'up' görünse bile sinsi bir arıza olabilir.",
  },
  "docker.stop_timeout": {
    label: "Durdurma bekleme süresi",
    help: "Docker önce nazikçe kapanmasını ister (SIGTERM), bu süre dolunca zorla kapatır. Veritabanı container'ları için kısa süre veri kaybına yol açabilir.",
    unit: "sn",
  },
  "docker.log_tail_lines": {
    label: "Log penceresinde gösterilecek geçmiş",
    unit: "satır",
  },
  "docker.autoprune.enabled": {
    label: "Otomatik temizlik",
    help: "Kapalı gelir: silinen bir image'ı geri getirmek yeniden indirmek demektir. Önce elle çalıştırıp ne sildiğini görmek yeğdir.",
  },
  "docker.autoprune.cron": {
    label: "Otomatik temizlik sıklığı",
  },
  "docker.autoprune.scope": {
    label: "Otomatik temizlik kapsamı",
    options: {
      "images-dangling": "Sarkan image'lar (en güvenli)",
      "build-cache": "Derleme önbelleği",
      "containers": "Durmuş container'lar",
      "images-unused": "Kullanılmayan tüm image'lar",
      "volumes": "Bağlı olmayan volume'lar (VERİ SİLER)",
    },
  },
  "updates.check_newer_tags": {
    label: "Daha yeni sürüm etiketi ara",
    help: "Panel bugüne kadar yalnızca ETİKETİN İÇERİĞİNİN değiştiğini görebiliyordu: 'nginx:1.24' güncellenirse haber veriyor ama 'nginx:1.26' çıktığını göremiyordu. Bu açıkken kayıt defterindeki etiket listesi de okunur ve daha yeni bir sürüm varsa söylenir. Öneri tek tıkla uygulanmaz — etiketi değiştirmek compose dosyasına dokunmak demek ve o karar senindir.",
  },
  "updates.max_bump": {
    label: "Önerilecek en büyük sıçrama",
    help: "Majör sürüm çıkışları çoğunlukla kırıcı değişiklik taşır ve yükseltmeden önce sürüm notlarını okumak gerekir; varsayılan minör, bu yüzden. Majörü seçmek önerileri kapatmaz, yalnızca listeye onları da katar.",
    options: {
      "yama": "Yalnızca yama (1.4.2 → 1.4.3)",
      "minor": "Minör sürüme kadar (→ 1.5.0)",
      "major": "Majör dahil her şey (→ 2.0.0)",
    },
  },
  "updates.match_flavor": {
    label: "Etiket çeşidini koru",
    help: "Açıkken '1.2-alpine' kullanan bir container'a yalnızca başka bir '-alpine' etiketi önerilir, düz '1.5' değil. Çeşit değiştirmek sürüm yükseltmek değil, başka bir taban imaja geçmektir — kapatırsan panel bunu bir yükseltme gibi önerir. Çok varyantlı imajlarda (php, node, postgres) gürültüyü en çok azaltan ayar budur.",
  },
  "updates.include_prerelease": {
    label: "Ön sürümleri de öner",
    help: "'-rc', '-beta', '-alpha' etiketleri. Kapalıyken bunlar hiç önerilmez; ama zaten bir ön sürüm kullanıyorsan (ör. 1.5.0-rc1) panel yine de bir sonraki ön sürümü ve nihai sürümü gösterir — o durumda saklamanın anlamı yok.",
  },
  "docker.update_vuln_gate": {
    label: "Güncelleme öncesi güvenlik kapısı",
    help: "Panel bir container'ı güncellemeden ÖNCE yeni imajı Trivy ile tarar ve bu ölçüte göre karar verir. 'daha_kotu' (varsayılan): yalnızca yeni imaj mevcuttan DAHA FAZLA açık taşıyorsa engeller — bir iyileşmeyi asla engellemez, bir gerilemeyi asla sessizce kabul etmez. 'kritik' ve 'kritik_yuksek' daha katıdır ama ters etkisi vardır: mevcut imajda 5 kritik açık varken 3 açıklı yeni imajı da engeller ve seni daha kötü yerde tutar. 'kapali' tarar ama engellemez. Tarama sırasında etiket eski imaja geri alınır, yani engellenen bir güncelleme container'a hiç dokunmaz.",
    options: {
      "daha_kotu": "Yalnızca daha kötüye giderse engelle",
      "kritik": "Kritik açık varsa engelle",
      "kritik_yuksek": "Kritik ya da yüksek açık varsa engelle",
      "kapali": "Tara ama engelleme",
    },
  },
  "docker.update_health_wait": {
    label: "Güncelleme sonrası doğrulama süresi",
    help: "Yeni container bu süre boyunca ayakta kalmazsa güncelleme geri alınır ve eski container geri getirilir. Yavaş açılan servisler (Home Assistant dakikalar sürebilir) için uzatılabilir.",
    unit: "sn",
  },
  "docker.exec_shell": {
    label: "Terminal kabuğu",
    help: "Alpine tabanlı image'larda bash yoktur; 'otomatik' bunu kendiliğinden halleder.",
    options: {
      "auto": "Otomatik (bash varsa bash, yoksa sh)",
      "/bin/bash": "/bin/bash",
      "/bin/sh": "/bin/sh",
      "/bin/ash": "/bin/ash (alpine)",
    },
  },
  "docker.exec_idle_minutes": {
    label: "Terminal boşta kalma süresi",
    help: "Sekmesi kapatılmış bir terminal container içinde kabuk bırakmasın; bu süre sonunda oturum kapatılır.",
    unit: "dk",
  },
  "docker.show_stopped": {
    label: "Durmuş container'ları da göster",
  },
  "docker.image_export_max_mb": {
    label: "Image dışa aktarma üst sınırı",
    help: "Dışa aktarılan tar arşivi indirilmeden önce panelin belleğine alınıyor; sınırsız bırakmak büyük bir imajda paneli belleksiz bırakır. Daha büyük imajlar için sunucuda 'docker save' kullan.",
    unit: "MB",
  },
  "docker.volume_op_timeout": {
    label: "Volume kopyalama zaman aşımı",
    help: "Volume klonlama tek seferlik bir container'da 'cp -a' ile yapılıyor. Büyük volume'lerde kopyalama dakikalar sürebilir; bu süre aşılırsa işlem iptal edilir ve yarım kalan hedef volume silinir.",
    unit: "sn",
  },
  "docker.volume_export_max_mb": {
    label: "Volume dışa aktarma üst sınırı",
    help: "Dışa aktarılan arşiv indirilmeden önce panelin belleğine alınıyor; sınırsız bırakmak büyük bir volume'de paneli belleksiz bırakır. Daha büyük volume'ler için yedekleme motorunu (restic) kullan. Docker boyutu hesaplayamadığı volume'lerde bu sınır uygulanmaz.",
    unit: "MB",
  },
  "docker.events_enabled": {
    label: "Docker olay akışını dinle",
    help: "Container'ların başlatma, durma, sonlanma ve OOM olayları Docker'dan canlı okunur ve olay kaydına yazılır. Bellek yetmediği için öldürülen (OOM) ve beklenmedik çıkış kodu ile sonlanan container'lar bildirim üretir; başlatma/durdurma gibi rutin olaylar yalnızca kaydedilir. Bir container'ın bildirim üretmesini istemiyorsan compose dosyasına 'panel.notify=false' etiketi yaz. Kapatmak akışı durdurur; olaylar bir daha görünmez.",
  },
  "docker.events_retention_days": {
    label: "Docker olaylarının saklama süresi",
    help: "Docker olayları alarmlardan çok daha sık yazılıyor (her başlat/durdur/yeniden başlat için bir satır), bu yüzden genel olay saklama süresinden ayrı ve daha kısa tutuluyor. Bu süreden eski Docker olayları budama işinde silinir; panelin kendi alarmları etkilenmez.",
    unit: "gün",
  },
  "docker.public_host": {
    label: "Container bağlantıları için sunucu adresi",
    help: "Container listesindeki yayınlanmış port rozetleri bu adrese bağlantı olur (ör. 192.168.61.114 ya da sunucu.local). Boş bırakılırsa paneli açtığın adres kullanılır — panele Tailscale üzerinden bağlanıyorsan bağlantılar da o adrese gider ve yerel ağdakinden farklı olabilir. Tek bir container için farklı bir adres gerekiyorsa compose dosyasına 'panel.url' ya da 'panel.port.<port>.url' etiketi yaz; etiket bu ayarın önüne geçer.",
  },
  "network.scan_enabled": {
    label: "Otomatik ağ taraması",
    help: "Kapalı gelir: tarama ev ağındaki her adrese bağlantı denemesi yapar ve bunu kullanıcının bilerek açması gerekir. Ekrandaki 'Şimdi tara' düğmesi bu ayardan bağımsız çalışır.",
  },
  "network.scan_cron": {
    label: "Tarama sıklığı",
  },
  "network.subnet": {
    label: "Taranacak alt ağ",
    help: "Boş bırakılırsa sunucunun kendi yönlendirme tablosundan bulunur (ör. 192.168.61.0/24). Yalnızca /16–/30 aralığı kabul edilir.",
  },
  "network.probe_timeout": {
    label: "Adres başına bekleme",
    unit: "sn",
  },
  "network.scan_concurrency": {
    label: "Eşzamanlı yoklama",
    help: "Yükseltmek taramayı hızlandırır ama ev yönlendiricisinin ARP tablosunu zorlayabilir.",
  },
  "network.oui_cron": {
    label: "Üretici listesi güncelleme",
    help: "IEEE'nin OUI listesi ayda bir değişiyor; MAC adreslerini üretici adına çevirmek için kullanılır. İnternet yoksa üretici alanı boş kalır, cihaz yine listelenir.",
  },
  "speedtest.enabled": {
    label: "Otomatik hız testi",
    help: "Kapalı gelir: her ölçüm onlarca megabayt indirip yüklüyor ve kotalı bağlantılarda bu bir maliyettir.",
  },
  "speedtest.cron": {
    label: "Hız testi sıklığı",
  },
  "speedtest.endpoint": {
    label: "Ölçüm sunucusu",
    help: "Cloudflare'in herkese açık uçları; anahtar istemiyor ve yakın bir kenar sunucusuna düşüyor. speedtest-cli kurulmadı: imaja onlarca megabayt ve Python bağımlılığı eklerdi.",
  },
  "speedtest.duration_seconds": {
    label: "Ölçüm penceresi",
    help: "Her yön için sayılan süre; öncesinde kısa bir ısınma var ve onun baytları sayılmaz. Sabit BAYT yerine sabit SÜRE ölçülüyor: hızlı bir hatta sabit bayt saniyenin onda birinde biter ve ölçülen şey hat değil gürültü olur. Pencere aşağıdaki bayt tavanı dolarsa erken biter.",
    unit: "sn",
  },
  "speedtest.max_bytes": {
    label: "Yön başına bayt tavanı",
    help: "Ölçüm penceresi süre dolmadan bu kadar bayt taşındıysa orada biter. Kotalı bağlantılar için maliyet freni: gigabit bir hatta yalnız süreyle sınırlı 10 saniyelik bir pencere yön başına 1 GB'ın üzerini taşır. Varsayılan 500 MB — 400 Mbit'e kadar olan hatlar tavana hiç değmez ve tam süreyi ölçer, gigabit hat ise yaklaşık 4-5 saniyelik pencere alır (eski sürümün ölçtüğü sürenin on katından fazlası).",
    unit: "bayt",
  },
  "speedtest.streams": {
    label: "Paralel akış",
    help: "Aynı anda açılan bağlantı sayısı. Tek akış hızlı bir hattı doyuramaz ve gerçek değerin çok altında sonuç verir; gerçek hız testi istemcileri de 4-8 akış açar.",
  },
  "speedtest.download_bytes": {
    label: "Akış başına indirme parçası",
    help: "Her akışın tek seferde istediği parça boyutu; pencere dolana kadar arka arkaya isteniyor. Toplam trafik değil — o, süre ve hıza göre belirlenir. DİKKAT: Cloudflare'in açık ucu BÜYÜK TEK İSTEKLERİ sınırlıyor — sunucuda ölçüldü, 10 MB ve üzeri istekler HTTP 429 alıp yaklaşık bir saat bloklanabiliyor, 5 MB ve altı serbest geçiyor. Küçültmek de bedava değil: aynı hatta 5 MB parça 845 Mbit ölçerken 1 MB parça istek başına düşen ek yük yüzünden yalnız 466 Mbit ölçtü.",
    unit: "bayt",
  },
  "speedtest.upload_bytes": {
    label: "Akış başına yükleme parçası",
    help: "Yalnızca TAMAMLANAN yüklemeler sayıldığı için parça, pencereye birkaç kez sığacak kadar küçük olmalı. Çok büyük seçilirse pencerede hiçbir istek bitmez ve panel tek seferlik ölçüme düşer.",
    unit: "bayt",
  },
  "speedtest.retention_days": {
    label: "Ölçüm saklama süresi",
    unit: "gün",
  },
  "network.alert_unknown": {
    label: "Yeni bilinmeyen cihazı bildir",
    help: "İlk taramada TÜM cihazlar yeni sayılır ve bildirim yağmuru olur; bu yüzden ilk tur bildirim üretmez.",
  },
  "tailscale.key_warn_days": {
    label: "Anahtar bitişine kaç gün kala uyar",
    help: "Düğüm anahtarı dolan cihaz tailnet'ten SESSİZCE düşer — sertifika bitişiyle aynı mantıkta izleniyor. Varsayılan ömür 180 gün.",
    unit: "gün",
  },
  "tailscale.check_cron": {
    label: "Anahtar kontrol sıklığı",
  },
  "proxy.caddy_container": {
    label: "Caddy container adı",
    help: "Yapılandırma değiştiğinde bu container'da 'caddy reload' çalıştırılır. Yeniden BAŞLATILMAZ: reload açık bağlantıları korur, restart panelin kendi oturumunu da düşürürdü.",
  },
  "proxy.default_tls": {
    label: "Yeni kayıtların TLS varsayılanı",
    help: "Yalnızca yeni kayıt formunun açılış değeri; mevcut kayıtlara dokunmaz. Yerel ağda .local adresleri yayınlıyorsan \"TLS yok\" seç: Let's Encrypt o adresler için hiçbir zaman mümkün değil, yerel CA ise her ziyarette sertifika uyarısı demek.",
    options: {
      "auto": "Let's Encrypt (gerçek alan adı)",
      "internal": "Caddy yerel CA",
      "off": "TLS yok (düz HTTP)",
    },
  },
  "proxy.diagnose_timeout_seconds": {
    label: "Yayın sınama zaman aşımı",
    help: "\"Yayını sına\" düğmesinin her adımı için üst sınır. Cevap vermeyen bir adresi süresiz beklemek, teşhisin kendisini kilitlerdi.",
    unit: "sn",
  },
  "proxy.diagnose_dns_server": {
    label: "Sınamada kullanılacak DNS sunucusu",
    help: "Panel container'ı genel DNS'e (1.1.1.1 gibi) bakar ve yerel adları (.local) bilmez; bu yüzden sınama, çözemediğinde yerel DNS sunucusuna doğrudan sorar. Boş bırakılırsa panele hangi IP'den erişildiyse o kullanılır — ev kurulumlarında yerel DNS genelde aynı makinededir. Pi-hole başka bir makinedeyse onun IP'sini yaz.",
  },
  "proxy.cert_check_cron": {
    label: "Sertifika kontrol sıklığı",
  },
  "proxy.cert_warn_days": {
    label: "Bitişe kaç gün kala uyar",
    help: "Let's Encrypt sertifikaları 90 günlük ve 30 gün kala yenilenir; 21 gün, yenilemenin çalışmadığını fark etmek için makul bir sınır.",
    unit: "gün",
  },
  "proxy.ddns_cron": {
    label: "DDNS kontrol sıklığı",
    help: "IP değişmediyse sağlayıcıya istek GİTMEZ; sık kontrol etmenin maliyeti yalnızca bir IP sorgusu.",
  },
  "proxy.public_ip_url": {
    label: "Genel IP servisi",
    help: "Düz metin olarak IP döndürmeli. Ayarda tutuluyor çünkü bu servisler kapanabiliyor ve panelin yeniden derlenmesi gerekmemeli.",
  },
  "home.latitude": {
    label: "Enlem",
    help: "Enlem ve boylamın ikisi de 0 ise hava durumu gösterilmez. Konumunu haritadan öğrenebilirsin; Open-Meteo kullanılıyor ve API anahtarı gerekmiyor.",
  },
  "home.longitude": {
    label: "Boylam",
  },
  "home.location_label": {
    label: "Konum adı",
    help: "Yalnızca ekranda gösterilir (ör. \"Kadıköy\").",
  },
  "home.internet_check_url": {
    label: "Kontrol adresi",
    help: "Ev halkı görünümündeki büyük göstergenin baktığı adres. Sunucudan bu adrese ulaşılabiliyorsa 'internet çalışıyor' denir. Dakikada bir kontrol edilir.",
  },
  "home.kiosk_refresh": {
    label: "Kiosk yenileme aralığı",
    help: "Duvara asılı ekran kendini bu aralıkla tazeler. Panelin genel yenileme aralığından ayrı: kiosk'ta veri tazeliğinden çok sessizlik önemli.",
    unit: "sn",
  },
  "apps.server_host": {
    label: "Sunucu adresi",
    help: "Kart adreslerindeki {host} yerine bu yazılır. Boş bırakılırsa paneli açtığın adres kullanılır — telefondan 192.168.61.114 ile giriyorsan kartlar da oraya bakar, dışarıdan bir alan adıyla giriyorsan oraya. Sabit bir adres istiyorsan buraya yaz.",
  },
  "apps.widget_ttl": {
    label: "Widget verisi tazeleme aralığı",
    help: "Ekran saniyeler aralıkla yenileniyor; widget verisi bu süre boyunca önbellekten sunulur. Kısaltmak, izlenen servise panelin daha sık yük bindirmesi demek.",
    unit: "sn",
  },
  "apps.discovery_enabled": {
    label: "Docker etiketlerinden kart oluştur",
    help: "Yalnızca ETİKETLENMİŞ container'lar için kart açılır; hiçbir container kendiliğinden kart olmaz.",
  },
  "apps.discovery_cron": {
    label: "Keşif sıklığı",
    help: "Uygulamalar ekranındaki 'Şimdi tara' düğmesiyle her an elle de çalıştırılabilir.",
  },
  "apps.label_prefix": {
    label: "Etiket öneki",
    help: "Container'a 'panel.enable=true' etiketi eklenince kart açılır. Diğer etiketler: .name .url .port .scheme .path .description .category .icon .internal_url",
  },
  "apps.login_screen": {
    label: "İşaretli kartları karşılama sayfasında göster",
    help: "Kart başına 'Karşılama sayfasında göster' seçeneği işaretlenmedikçe hiçbir kart görünmez; bu düğme tüm listeyi tek hamlede kapatmak için — işaretleri tek tek silmeden. Panel dışarıya açıksa unutma: karşılama sayfasındaki kartların adını, logosunu ve adresini oturum açmamış herkes görür.",
  },
  "welcome.notice": {
    label: "Duyuru",
    help: "Karşılama sayfasının üstünde şerit olarak görünür. BOŞ bırakılırsa şerit hiç çizilmez — duyurunun varsayılanı budur. Buraya yazdığın metni oturum açmamış herkes görür; sunucunun durumuyla ilgili ayrıntı değil, ev halkına söylenecek bir şey yaz (ör. 'Bu akşam 21-23 arası internet kesintisi olacak').",
  },
  "welcome.notice_level": {
    label: "Duyuru rengi",
    options: {
      "info": "Bilgi (mavi)",
      "warn": "Uyarı (turuncu)",
    },
  },
  "alerts.temp.warn": {
    label: "Sıcaklık — uyarı eşiği",
    help: "Sensör kendi eşiğini bildiriyorsa (çoğu işlemci bildirir) o değer önceliklidir; bu yalnızca bildirmeyenler için.",
    unit: "°C",
  },
  "alerts.temp.crit": {
    label: "Sıcaklık — kritik eşik",
    unit: "°C",
  },
  "hardware.temp_sources": {
    label: "İzlenecek sensörler",
    help: "Virgülle ayrılmış sensör kimlikleri (ör. coretemp/temp1). Boş bırakılırsa bulunan tüm sensörler izlenir.",
  },
  "hardware.raid.scrub_overdue_days": {
    label: "Scrub gecikmesi uyarısı",
    help: "RAID/ZFS havuzu bu süredir doğrulanmadıysa uyarır. Sessiz veri bozulması ancak scrub ile yakalanır.",
    unit: "gün",
  },
  "hardware.report_stale_hours": {
    label: "S.M.A.R.T raporu eskime eşiği",
    help: "S.M.A.R.T ve ZFS verisi host'ta çalışan scripts/hardware.sh tarafından üretilir. Rapor bu süreden eskiyse uyarılır — sessizce eski veri göstermek, hiç göstermemekten kötüdür.",
    unit: "saat",
  },
  "alerts.capacity_forecast_days": {
    label: "Kapasite uyarı ufku",
    help: "Bir disk bu süre içinde dolacak gibi görünüyorsa uyarır. Yarısından kısaysa kritik olur.",
    unit: "gün",
  },
  "capacity.window_days": {
    label: "Trend hesabında bakılacak geçmiş",
    help: "Uzun pencere yavaş sızıntıları yakalar, kısa pencere ani değişime hızlı tepki verir.",
    unit: "gün",
  },
  "capacity.min_history_days": {
    label: "Tahmin için gereken en az geçmiş",
    help: "Bu kadar günlük veri birikmeden tahmin yapılmaz. İki saatlik veriden 'yarın dolar' demek, bir dosya kopyalamayı felakete çevirir.",
    unit: "gün",
  },
  "capacity.min_confidence": {
    label: "Alarm için gereken uyum (R²)",
    help: "Veri düz bir eğilim göstermiyorsa tahmin gösterilir ama alarm üretmez. Zıplayan seriyi doğru sanmak yanlış alarm demektir.",
    unit: "%",
  },
  "alerts.flap_threshold": {
    label: "Bildirim öncesi doğrulama turu",
    help: "Bir durum bu kadar ardışık turda aynı kalmadan bildirilmez. Sınırda gidip gelen bir değerin telefonu çaldırıp durmasını engeller.",
  },
  "alerts.dedup_window": {
    label: "Aynı alarmı tekrar bildirme aralığı",
    help: "Aynı sorun bu süre içinde tekrar bildirilmez. 0 = her turda bildir (önerilmez).",
    unit: "dk",
  },
  "alerts.escalate_after": {
    label: "Çözülmeyen kritik alarmı hatırlat",
    help: "Kritik bir alarm bu süre boyunca sürerse yeniden bildirilir. 0 = kapalı.",
    unit: "dk",
  },
  "alerts.quiet_hours.enabled": {
    label: "Sessiz saatler",
    help: "Bu aralıkta bildirim gönderilmez; olaylar yine kaydedilir ve panelde görünür.",
  },
  "alerts.quiet_hours.start": {
    label: "Sessiz saat başlangıcı",
  },
  "alerts.quiet_hours.end": {
    label: "Sessiz saat bitişi",
  },
  "alerts.quiet_hours.critical_bypass": {
    label: "Kritik alarmlar sessiz saatleri delsin",
    help: "Disk dolmak üzereyse ya da sunucu erişilemezse gece de haber ver.",
  },
  "alerts.retention_months": {
    label: "Olay kaydı saklama",
    unit: "ay",
  },
  "alerts.timeline_jump_pct": {
    label: "Sıçrama eşiği (yüzdelik metrikler)",
    help: "Zaman çizelgesinde bir dakikadan diğerine bu kadar puan artan CPU, bellek, disk ve container ölçümleri işaretlenir. Bu bir alarm değil — çizelgede 'tam o anda ne oldu' sorusunu cevaplamaya yarar.",
    unit: "puan",
  },
  "alerts.timeline_net_jump_mbps": {
    label: "Sıçrama eşiği (ağ trafiği)",
    help: "Ağ hızı yüzde değil mutlak değer taşıdığı için ayrı eşik. 0'a indirilemez; kapatmak için çizelgede sıçrama filtresini kapatman yeterli.",
    unit: "Mbit/sn",
  },
  "notify.telegram.enabled": {
    label: "Etkin",
  },
  "notify.telegram.token": {
    label: "Bot token",
  },
  "notify.telegram.chat_id": {
    label: "Sohbet (chat) kimliği",
    help: "Botun kullanıcı adı DEĞİL, sayısal kimlik (ör. 123456789). Bota bir mesaj yolladıktan sonra https://api.telegram.org/bot<TOKEN>/getUpdates adresinde result[0].message.chat.id olarak görünür.",
  },
  "notify.telegram.min_level": {
    label: "En düşük seviye",
    options: {
      "info": "Bilgi ve üstü",
      "warning": "Uyarı ve üstü",
      "critical": "Yalnızca kritik",
    },
  },
  "notify.ha.enabled": {
    label: "Etkin",
  },
  "notify.ha.url": {
    label: "Sunucu adresi",
    help: "Ör. http://192.168.61.114:8123",
  },
  "notify.ha.token": {
    label: "Uzun ömürlü erişim token'ı",
  },
  "notify.ha.service": {
    label: "Bildirim servisi",
    help: "Ör. notify.mobile_app_telefonum",
  },
  "notify.ha.min_level": {
    label: "En düşük seviye",
    options: {
      "info": "Bilgi ve üstü",
      "warning": "Uyarı ve üstü",
      "critical": "Yalnızca kritik",
    },
  },
  "notify.ntfy.enabled": {
    label: "Etkin",
  },
  "notify.ntfy.url": {
    label: "Sunucu adresi",
    help: "Varsayılan: https://ntfy.sh",
  },
  "notify.ntfy.topic": {
    label: "Konu (topic)",
  },
  "notify.ntfy.token": {
    label: "Erişim token'ı (isteğe bağlı)",
  },
  "notify.ntfy.min_level": {
    label: "En düşük seviye",
    options: {
      "info": "Bilgi ve üstü",
      "warning": "Uyarı ve üstü",
      "critical": "Yalnızca kritik",
    },
  },
  "notify.discord.enabled": {
    label: "Etkin",
  },
  "notify.discord.webhook": {
    label: "Webhook adresi",
  },
  "notify.discord.min_level": {
    label: "En düşük seviye",
    options: {
      "info": "Bilgi ve üstü",
      "warning": "Uyarı ve üstü",
      "critical": "Yalnızca kritik",
    },
  },
  "notify.email.enabled": {
    label: "Etkin",
  },
  "notify.email.smtp_host": {
    label: "SMTP sunucusu",
  },
  "notify.email.smtp_port": {
    label: "SMTP portu",
  },
  "notify.email.secure": {
    label: "Baştan TLS (port 465)",
    help: "587 için kapalı bırak — STARTTLS kendiliğinden kullanılır.",
  },
  "notify.email.user": {
    label: "Kullanıcı adı",
  },
  "notify.email.password": {
    label: "Parola",
  },
  "notify.email.from": {
    label: "Gönderen adresi",
  },
  "notify.email.to": {
    label: "Alıcı adresleri",
    help: "Virgülle ayır.",
  },
  "notify.email.min_level": {
    label: "En düşük seviye",
    options: {
      "info": "Bilgi ve üstü",
      "warning": "Uyarı ve üstü",
      "critical": "Yalnızca kritik",
    },
  },
  "updates.os_alert_level": {
    label: "Ne zaman uyarılsın",
    help: "Güncellemeleri panel KURMAZ; yalnızca haber verir. Çekirdek güncellemesi yeniden başlatma ister ve bunu gece 3'te kendiliğinden yapan bir panel, çözdüğünden çok sorun çıkarır.",
    options: {
      "off": "Uyarma (yalnızca panelde göster)",
      "security": "Yalnızca güvenlik güncellemelerinde",
      "any": "Herhangi bir güncellemede",
    },
  },
  "updates.report_stale_hours": {
    label: "Rapor eskime eşiği",
    help: "Host'taki os-updates.sh bu süredir çalışmadıysa uyarılır — sessizce eski liste göstermek, hiç göstermemekten kötüdür.",
    unit: "saat",
  },
  "updates.image_check_cron": {
    label: "Image güncelleme kontrolü sıklığı",
    help: "Kayıt defterinden yalnızca sürüm özeti sorulur, image indirilmez.",
  },
  "updates.image_alert": {
    label: "Yeni image sürümünde bildirim gönder",
    help: "Varsayılan kapalı: image güncellemesi acil bir arıza değil, bir bakım işidir. Panelde her zaman görünür.",
  },
  "backup.watch_dir": {
    label: "İzlenecek yedek klasörü",
    help: "Host üzerindeki tam yol (ör. /mnt/yedek). Boş bırakılırsa takip kapalıdır. Yedekleme motoru M3.4'te gelecek; bu yalnızca 'en son yedek ne zaman alındı' sorusuna bakar.",
  },
  "backup.stale_after_hours": {
    label: "Yedek eskime eşiği",
    help: "En yeni yedek bu süreden eskiyse alarm üretilir. Yedekleme sisteminin en sinsi arızası çökmesi değil, sessizce durmasıdır.",
    unit: "saat",
  },
  "appstore.stacks_dir": {
    label: "Yığın kök dizini",
    help: "Panelden kurulan her yığın bunun altında kendi klasörüne yazılır. DİKKAT: bu yol, host-helper'ın izin listesindeki compose dizin deseniyle uyuşmalı — uyuşmazsa dosya yazılır ama 'compose up' host tarafından reddedilir. Mevcut compose dizinini göstermek (ör. /home/kullanici/docker) genelde en pratik çözümdür. Panel var olan bir compose dosyasının ÜZERİNE yazmaz. Compose Yığınları ekranı bu dizini açılışta sınar ve uyuşmazlığı kurulumdan ÖNCE söyler.",
  },
  "appstore.file_owner": {
    label: "Kurulan dosyaların sahibi",
    help: "Host'un kullanıcı ve grup listesinden seçilir (uid:gid olarak saklanır). Panel compose dosyasını root olan geçici bir container'la yazar; varsayılan 0:0 çünkü /opt gibi yollara ancak root yazabilir. Yığın dizini kendi ev dizininse (ör. /home/kullanici/docker) burayı kendi uid:gid'ine çevir — yoksa kurulan dosyalar root'a ait olur ve SSH'tan sudo'suz düzenleyemezsin.",
  },
  "appstore.keep_backups": {
    label: "Saklanacak compose yedeği",
    help: "Panel bir compose dosyasını düzenlemeden ÖNCE yanına '<dosya>.panel-yedek-<zaman>' kopyası bırakır; bu, kaç tanesinin tutulacağını belirler. Eskiler otomatik silinir. Yedekler yığın dizininde durur, panelin veri alanında değil — SSH'tan da elle geri yükleyebilirsin.",
  },
  "docker.file_max_kb": {
    label: "Container dosya boyutu sınırı (KB)",
    help: "Container içinden okunabilecek ve içine yazılabilecek en büyük dosya. Dosya panelin belleğinden geçtiği için sınırsız bırakmak, tek bir yanlış tıklamada (ör. bir veritabanı dosyasını açmak) paneli tüketebilir. Sınırı aşan dosyalar listede görünür ama açılmaz.",
  },
  "hostcron.forbidden": {
    label: "Yasaklı komut parçaları",
    help: "Virgülle ayrılmış metinler. Bir cron komutu bunlardan birini içeriyorsa panel kaydetmez. Kötü niyeti durdurmaz (host'ta root olan zaten yazar) — kazayı durdurur. Boş bırakılırsa sınır kalkar.",
  },
  "console.forbidden": {
    label: "Yasaklı komut parçaları",
    help: "Virgülle ayrılmış metinler. Konsola yazılan komut bunlardan birini içeriyorsa panel host'a hiç göndermez. Host cron'daki gibi bu da kaza koruması, güvenlik sınırı değil — asıl sınır host'taki izin listesidir. Boş bırakılırsa sınır kalkar.",
  },
  "console.history_lines": {
    label: "Konsol çıktısı üst sınırı",
    help: "Konsol penceresinde tutulacak satır sayısı. Aşıldığında en eski satırlar düşer; tarayıcının uzun bir `apt upgrade` çıktısı yüzünden yavaşlamasını engeller.",
    unit: "satır",
  },
  "dbadmin.max_rows": {
    label: "Sorgu satır limiti",
    help: "LIMIT'i olmayan her SELECT'e bu değer otomatik eklenir. Kazayla açılan 'SELECT * FROM olaylar' panelin belleğini yemesin diye.",
    unit: "satır",
  },
  "dbadmin.timeout_seconds": {
    label: "Sorgu zaman aşımı",
    help: "Bağlanma ve sorgu çalıştırma için üst sınır. Süreyi aşan sorgu iptal edilir.",
    unit: "sn",
  },
  "files.roots": {
    label: "İzinli kök dizinler",
    help: "Klasörler listeden SEÇİLİR — elle yazılan bir yol sessizce \"izinli kökler dışında\" hatası üretiyordu. Dosya yöneticisi YALNIZCA bunların altını görebilir. Boş bırakılırsa dosya yöneticisi tamamen kapanır. /proc, /sys, /dev ve /run listede olsalar bile erişilemez. /etc varsayılana DAHİL DEĞİL: okuma yükseltilmiş yetkiyle çalıştığı için sistem yapılandırmasını gözatılabilir yapmak bilinçli bir karar olmalı (shadow, sudoers ve özel anahtarlar eklense bile okunamaz).",
  },
  "files.max_edit_kb": {
    label: "Düzenlenebilir dosya üst sınırı",
    help: "Bundan büyük dosyalar düzenleyicide kesilerek gösterilir; kaydetmek dosyayı kırpardı, bu yüzden salt-okunur açılır.",
    unit: "KB",
  },
  "files.max_download_mb": {
    label: "Yükseltilmiş indirme üst sınırı",
    help: "Panel kullanıcısının okuyamadığı (root'a ait) dosyalar geçici bir container üzerinden belleğe alınarak indirilir; bu yüzden bir tavan var. Panelin okuyabildiği dosyalar akış olarak iner ve bu sınıra takılmaz.",
    unit: "MB",
  },
  "files.scan_timeout_seconds": {
    label: "Disk analizi zaman sınırı",
    help: "Klasör boyutu hesaplama bu süreyi aşarsa elde olan sonuçlar gösterilir ve 'eksik' işaretlenir. Sınırsız bir tarama büyük dosya sistemlerinde dakikalarca sürer.",
    unit: "sn",
  },
  "files.helper_image": {
    label: "Yazma işlemleri için imaj",
    help: "Panel host'a doğrudan yazamaz (host kökü salt-okunur bağlı). Yazma gerektiren işlemler yalnızca hedef klasörü yazılabilir bağlayan tek seferlik bir container'da çalışır.",
  },
  "backup.restic_image": {
    label: "restic imajı",
    help: "Yedekleme, host'a hiçbir şey kurmadan bu imajdan üretilen tek seferlik bir container içinde çalışır. Sürümü sabitlemek istersen etiketi değiştir (ör. restic/restic:0.19.1).",
  },
  "backup.timeout_minutes": {
    label: "Yedekleme zaman aşımı",
    help: "Tek bir restic komutu bu süreyi aşarsa iş başarısız sayılır. İlk yedek en uzun sürendir; sonrakiler yalnızca değişeni yazar.",
    unit: "dk",
  },
  "logs.enabled": {
    label: "Log toplama açık",
    help: "Kapatıldığında toplanmış loglar silinmez, yalnızca yenisi eklenmez.",
  },
  "logs.sources": {
    label: "Toplanacak container'lar",
    help: "Container'lar listeden işaretlenir. Hiçbiri seçilmezse çalışan tüm container'lar toplanır. Panelin kendi container'ı hiçbir zaman toplanmaz — kendi loglarını yiyerek büyürdü.",
  },
  "logs.max_lines_per_source": {
    label: "Tur başına kaynak limiti",
    help: "Bir toplama turunda tek kaynaktan alınacak en fazla satır. Aniden konuşkanlaşan bir container'ın tüm turu tüketmesini engeller.",
    unit: "satır",
  },
  "logs.journald_enabled": {
    label: "Host journald loglarını da topla",
    help: "host-helper üzerinden okunur ve izin listesinde 'journal.read' satırı gerektirir (root ekler). Satır yoksa toplama sessizce atlanır, hata vermez.",
  },
  "logs.retention_days": {
    label: "Saklama süresi",
    help: "Bu süreden eski satırlar budama işinde silinir.",
    unit: "gün",
  },
  "logs.max_total_lines": {
    label: "Toplam satır tavanı",
    help: "Yaş eşiği tek başına yetmez: konuşkan tek bir container saklama süresi dolmadan veritabanını gigabaytlara çıkarabilir. Tavan aşılırsa en eskiden kesilir.",
    unit: "satır",
  },
  "security.audit_retention_months": {
    label: "Audit kaydı saklama",
    help: "Bu süreden eski audit kayıtları budama işiyle silinir.",
    unit: "ay",
  },
  "security.trivy_image": {
    label: "Tarayıcı imajı",
    help: "CVE taraması bu imajdan üretilen tek seferlik bir container'da çalışır. Trivy'nin açık veritabanı kalıcı bir volume'de tutulur; her tarama yeniden indirmez.",
  },
  "security.scan_timeout_minutes": {
    label: "Tarama zaman aşımı",
    help: "İlk tarama en uzun sürendir: açık veritabanı indiriliyor (yüzlerce MB).",
    unit: "dk",
  },
  "security.trivy_remote": {
    label: "İmajı kayıt defterinden oku",
    help: "Varsayılan kapalı: imaj zaten yerelde ve Docker'dan okumak hızlı. Çok katmanlı büyük imajlarda (ör. Home Assistant, 3,4 GB) Trivy Docker'dan okuyamıyor — bilinen bir sınır. Bu seçenek imajı kayıt defterinden yeniden indirir; çalışır ama uzun sürer ve bant genişliği harcar.",
  },
  "security.scan_retention_days": {
    label: "Tarama geçmişi saklama",
    unit: "gün",
  },
  "security.upnp_enabled": {
    label: "Router'a UPnP ile port yönlendirmesi sor",
    help: "Varsayılan kapalı. Açıldığında panel yerel ağa SSDP yayını yapar ve yönlendiricideki UPnP kayıtlarını okur. YALNIZCA UPnP ile açılmış yönlendirmeler görünür — router arayüzünden elle eklenenler listede çıkmayabilir.",
  },
  "security.upnp_timeout_seconds": {
    label: "UPnP zaman aşımı",
    unit: "sn",
  },
  "security.session_ttl_hours": {
    label: "Oturum ömrü",
    help: "Girişte \"Beni hatırla\" işaretlenMEdiğinde geçerli olan süre. Yeni oturumlar için geçerlidir; mevcut oturumlar etkilenmez.",
    unit: "saat",
  },
  "security.remember_me_days": {
    label: "\"Beni hatırla\" süresi",
    help: "Yalnızca girişte kutu işaretlendiğinde geçerli; işaretlenmezse yukarıdaki saat değeri kullanılır. Uzun süre, cihaz kaybedildiğinde de oturumun uzun süre açık kalması demek — paylaşılan bir makinede kutuyu işaretleme.",
    unit: "gün",
  },
  "security.login_max_attempts": {
    label: "Hesap kilitlenmeden önceki hatalı deneme",
  },
  "security.lockout_minutes": {
    label: "Kilitleme süresi",
    unit: "dk",
  },
  "jobs.sessions_prune_cron": {
    label: "Oturum temizliği sıklığı",
  },
  "jobs.api_tokens_prune_cron": {
    label: "API anahtarı budama sıklığı",
  },
  "jobs.audit_prune_cron": {
    label: "Audit budama sıklığı",
  },
  "jobs.uptime_prune_cron": {
    label: "Uptime budama sıklığı",
  },
  "jobs.events_prune_cron": {
    label: "Olay kaydı budama sıklığı",
  },
  "jobs.logs_collect_cron": {
    label: "Log toplama sıklığı",
    help: "Sıklaştırmak gecikmeyi azaltır ama her tur container başına bir Docker çağrısı demektir. Beş dakika, aramanın işe yaraması için fazlasıyla yeterli.",
  },
  "jobs.logs_prune_cron": {
    label: "Log budama sıklığı",
  },
  "jobs.vuln_scan_cron": {
    label: "Güvenlik açığı taraması",
    help: "Haftada bir yeter: açık veritabanı günlük güncelleniyor ama image'lar o hızda değişmiyor ve tarama uzun sürüyor.",
  },
  "jobs.upnp_scan_cron": {
    label: "Port yönlendirme kontrolü",
    help: "Saatte bir. Amaç, senden habersiz açılan bir yönlendirmeyi erken yakalamak.",
  },
  "jobs.port_scan_cron": {
    label: "Port haritası taraması",
    help: "Saatte bir. Bu iş kapalıysa Port Haritası ekranı ilk açılışta boş gelir ve kullanıcı elle taramak zorunda kalır.",
  },
  "jobs.backup_scheduler_cron": {
    label: "Yedekleme zamanlayıcısı",
    help: "Her yedekleme işinin kendi sıklığı var; bu ayar yalnızca 'vadesi geleni kontrol et' turunun ne sıklıkta koşacağını belirler. Sık koşması ucuz — vadesi gelen iş yoksa hiçbir şey yapmaz.",
  },
  "jobs.mqtt_publish_cron": {
    label: "MQTT yayını sıklığı",
    help: "Metriklerin MQTT'ye basılma sıklığı. Sıklaştırmak broker'ı yormaz (mesajlar küçük ve saklanıyor) ama HA'daki grafiklerin çözünürlüğünü artırır.",
  },
  "integration.mqtt.enabled": {
    label: "MQTT yayını açık",
  },
  "integration.mqtt.host": {
    label: "Broker adresi",
    help: "Mosquitto container'ı aynı makinedeyse container adı da yazılabilir (ör. mosquitto).",
  },
  "integration.mqtt.port": {
    label: "Port",
  },
  "integration.mqtt.tls": {
    label: "TLS kullan",
    help: "SINIR: ev kurulumlarındaki kendinden imzalı sertifikalar için zincir doğrulaması kapalı. Yani trafik ŞİFRELENİR ama broker'ın kimliği DOĞRULANMAZ — aynı ağda araya girebilen biri broker taklidi yapabilir.",
  },
  "integration.mqtt.username": {
    label: "Kullanıcı adı",
  },
  "integration.mqtt.password": {
    label: "Parola",
  },
  "integration.mqtt.client_id": {
    label: "İstemci kimliği",
    help: "Broker'da aynı kimlikle iki istemci bağlanamaz; başka bir yerde de kullanıyorsan değiştir.",
  },
  "integration.mqtt.base_topic": {
    label: "Kök konu",
    help: "Metrikler <kök>/metric/... , birleşik durum <kök>/state , olaylar <kök>/event/<kaynak> konularına basılır.",
  },
  "integration.mqtt.timeout_seconds": {
    label: "Bağlantı zaman aşımı",
    unit: "sn",
  },
  "integration.mqtt.publish_events": {
    label: "Olayları da yayınla",
    help: "Alarm ve olaylar oluştukları anda MQTT'ye basılır (saklanmadan). HA tarafında 'panel kritik olay ürettiğinde bildirim gönder' yazılabilir.",
  },
  "integration.mqtt.discovery": {
    label: "Home Assistant otomatik keşfi",
    help: "Açıldığında panel metrikleri HA'da kendiliğinden sensör olarak belirir; elle yapılandırma gerekmez. Kapatıldığında ilanlar geri alınır ve entity'ler HA'dan silinir.",
  },
  "integration.mqtt.discovery_prefix": {
    label: "Keşif konu öneki",
    help: "HA'nın MQTT entegrasyonundaki 'discovery prefix' ile aynı olmalı. Varsayılanı değiştirmediysen dokunma.",
  },
  "integration.prometheus.enabled": {
    label: "/metrics ucu açık",
    help: "Dış API ana şalterine BAĞLIDIR: /metrics de bearer token ile kimlik doğruluyor, o yüzden 'Dış API' kapalıyken bu ayar etkisizdir.",
  },
  "integration.prometheus.include_containers": {
    label: "Container metriklerini de ver",
    help: "Her container için ek satır ve her scrape'te ek sorgu demek. Etikette container ADI kullanılır, id değil — id her recreate'te değişir ve Prometheus'ta her seferinde yeni bir zaman serisi açardı.",
  },
  "api.enabled": {
    label: "Dış API açık",
    help: "Kapalıyken /api/v1 ve /metrics 404 döner. Bilerek kapalı geliyor: API'yi açmak, panele parola dışında ikinci bir giriş yolu açmaktır.",
  },
  "api.rate_limit_per_minute": {
    label: "Anahtar başına istek sınırı",
    help: "Meşru bir istemcinin paneli boğmasını engeller. Aşımda 429 + Retry-After.",
    unit: "istek/dk",
  },
  "api.auth_rate_limit_per_minute": {
    label: "IP başına başarısız kimlik denemesi",
    help: "Anahtar tahmin/tarama denemesine karşı. Yalnızca BAŞARISIZ denemeler sayılır, başarılı olan sayacı sıfırlar — tek IP arkasındaki meşru trafik cezalandırılmasın.",
    unit: "deneme/dk",
  },
  "api.token_default_ttl_days": {
    label: "Yeni anahtarın varsayılan ömrü",
    help: "0 = süresiz. Anahtar üretme ekranında değiştirilebilir; bu yalnızca varsayılan.",
    unit: "gün",
  },
  "api.device_token_ttl_days": {
    label: "Mobil cihaz anahtarının ömrü",
    help: "Cihaz doğrulamasından sonra otomatik üretilen anahtar için. Yenileme yeni anahtar üretip eskisini iptal eder; sızmış eski değer en fazla bu kadar yaşar.",
    unit: "gün",
  },
  "api.max_tokens_per_user": {
    label: "Kullanıcı başına aktif anahtar",
    help: "Yalnızca iptal edilmemiş anahtarlar sayılır. İptal edilenler de sayılsaydı, anahtar döndüren bir kullanıcı bir gün kendi geçmişi yüzünden kilitlenirdi.",
    unit: "anahtar",
  },
  "api.max_body_bytes": {
    label: "En büyük istek gövdesi",
    unit: "bayt",
  },
  "api.last_used_write_interval": {
    label: "Son kullanım yazma aralığı",
    help: "15 saniyede bir scrape eden bir Prometheus, kısma olmadan günde ~5.760 gereksiz yazma demek. IP değiştiğinde eşik beklenmez.",
    unit: "sn",
  },
  "api.idempotency_window_seconds": {
    label: "Idempotency-Key penceresi",
    help: "host-helper'ın kendi tekrar penceresiyle aynı olmalı (varsayılan 300 sn); iki farklı süre arada tanımsız bir bölge bırakır.",
    unit: "sn",
  },
  "api.token_retention_days": {
    label: "İptal edilmiş anahtar saklama süresi",
    help: "0 = hiç silme. İptal satırları audit izi için tutuluyor; bu süre onların ne kadar saklanacağını belirler.",
    unit: "gün",
  },
};

export type SettingItemsDict = typeof settingItems;
