/**
 * Sayfa yardımları — her ekranın köşesindeki "?" düğmesinin içeriği.
 *
 * KODDA duruyor, veritabanında değil. Bir ekranın ne yaptığı koddan türeyen
 * bir gerçek; ikisi birlikte değişmeli ve "bu açıklama ne zaman değişti"nin
 * cevabı git geçmişi olmalı. Ayarlardan düzenlenebilir olsaydı, kod değişip
 * metin eskidiğinde kimse fark etmezdi.
 *
 * Üç başlık bilinçli: kullanıcının sorduğu şey hep aynı üç soru — bu ekran
 * ne işe yarar, arkasında ne dönüyor, neye dikkat etmeliyim.
 *
 * Ayarların alt sayfaları BURADA YOK: metinleri `settings.schema.ts`'teki
 * grup açıklamalarından geliyor (bkz. PageHelp). İki ayrı açıklama tutmak,
 * ikisinin zamanla ayrışması demekti.
 */

export type HelpEntry = {
  /** Bu ekran ne işe yarar. */
  amac: string;
  /** Arkada ne dönüyor — veriyi nereden alıyor, ne zaman güncelleniyor. */
  nasil: string;
  /** Bilinmesi gereken sınır ya da tuzak; yoksa boş. */
  dikkat?: string;
};

export const pageHelp: Record<string, HelpEntry> = {
  "/panel": {
    amac: "Sunucunun tek bakışta özeti: anlık CPU, bellek, disk ve ağ kullanımı, container sayısı, açık alarmlar ve senin seçtiğin kartlar.",
    nasil: "Metrikler arka planda çalışan toplama işiyle kaydediliyor; bu ekran son kaydı gösteriyor, her açılışta sunucuyu yeniden ölçmüyor. Hangi kutucukların görüneceğini ve sıralarını sürükleyerek değiştirebilirsin — düzen kullanıcıya özeldir.",
    dikkat:
      "Değerler ayarlardaki toplama aralığı kadar gecikmeli olabilir. Anlık bir sorunu kovalıyorsan İzleme ekranındaki grafikler daha ince çözünürlük verir.",
  },

  "/apps": {
    amac: "Sunucundaki servislere tek tıkla gitmek için kart panosu. Kartlar kategorilere ayrılır, sürüklenerek sıralanır ve istersen ana sayfada da görünür.",
    nasil:
      "Kartları elle ekleyebilir ya da Docker etiketlerinden otomatik keşfettirebilirsin. Bir container seçtiğinde adres, yayınlanmış portundan kendiliğinden doldurulur. Adresteki {host} yer tutucusu, panele hangi adresle geldiysen ona çözülür — böylece aynı kart hem evden hem tailnet üzerinden çalışır.",
    dikkat:
      "Otomatik keşfedilen bir kartı elle düzenlersen kart 'senin' olur ve keşif turu bir daha üstüne yazmaz. Kartı silersen etiket duruyorsa bir sonraki turda geri gelir; kalıcı kaldırmanın yolu container etiketini silmektir.",
  },

  "/appstore": {
    amac: "Kendi docker-compose.yml dosyanı panelden kurmak ve kurulu yığınları yönetmek. Burada bir uygulama katalogu vardı ve kaldırıldı: yüzlerce hazır şablon eklenmesine rağmen gerçekte yapılan şey her zaman kendi compose dosyasını getirmekti.",
    nasil:
      "Dosyayı sürükle ya da seç; içeriği ekranda düzenlenebilir olarak açılır. 'Ön kontrol' düğmesi kurulmadan ÖNCE dosyayı denetler: port çakışması (hangi portu kimin tuttuğunu adıyla söyler), derlenmesi gereken servis, eksik yeniden başlatma politikası, sınırsız büyüyecek log ayarı, silinmeye açık anonim volume ve bulunamayan dış ağ. Engel bulunursa kurulum başlamaz; öneriler tek tıkla uygulanır. Panel dosyayı yığın kök dizininin altına yazar, 'docker compose config' ile doğrular ve ancak geçerliyse host üzerinde 'docker compose up' çalıştırır. Kurulumdan sonra yığını başlatma, yeniden başlatma, imaj güncelleme ve kaldırma aynı ekrandan yapılır.",
    dikkat:
      "Ön kontrol her şeyi yakalayamaz: tanımsız ${DEĞİŞKEN} gibi sorunları ancak 'compose config' görür ve panel onun uyarılarını kurulum sonrası ekrana basar — 'parola boş kaldı' türü sessiz hataların tek erken işareti odur. Yığın kök dizini, host'taki izin listesinin compose desenine uymak zorunda. Uymuyorsa ekranın tepesinde uyarı ve yapıştırılacak satırlar çıkar. Panel var olan bir compose dosyasının üzerine asla yazmaz; 'Kaldır' ise dosyaları ve veriyi diskte bırakır. Yüklediğin dosyanın içeriğinden sen sorumlusun — panel onu doğrular ama ne yaptığını denetlemez.",
  },

  "/monitoring": {
    amac: "CPU, bellek, disk, ağ ve sıcaklık geçmişinin grafikleri. 'Dün gece ne oldu' sorusunun cevabı burada.",
    nasil:
      "Ham örnekler zamanla dakika, saat ve gün katmanlarına toplanıyor; geniş bir aralık seçtiğinde daha kaba ama çok daha hızlı gelen katman kullanılır. Saklama süreleri ayarlardan yönetilir.",
    dikkat:
      "Eski veriler saklama süresi dolunca silinir — uzun dönem karşılaştırma yapacaksan süreleri önceden uzat, sonradan geri getirilemez.",
  },

  "/uptime": {
    amac: "Servislerin ayakta olup olmadığını düzenli aralıklarla yoklar ve kesintileri kaydeder. Bakım pencereleri tanımlayarak planlı kesintilerde alarm üretilmesini engelleyebilirsin.",
    nasil:
      "Her monitörün kendi aralığı ve zaman aşımı var. Bir kontrol düştüğünde hemen alarm üretilmez: ayarlardaki doğrulama turu sayısı kadar üst üste başarısız olması beklenir — tek seferlik ağ takılmaları gürültü yapmasın diye.",
    dikkat:
      "Bakım penceresi içindeki kesintiler kaydedilir ama bildirim göndermez; çalışma süresi yüzdesine de katılmaz.",
  },

  "/events": {
    amac: "Panelin ürettiği tüm olaylar ve alarmlar: eşik aşımları, servis kesintileri, sertifika bitişleri, yeni ağ cihazları.",
    nasil:
      "Container'ların başlat, durdur, sonlan, öldürül ve OOM olayları Docker'dan canlı okunup buraya 'docker' kaynağıyla yazılır. Bellek yetmediği için öldürülen (OOM) ve beklenmedik çıkış koduyla sonlanan container'lar bildirim üretir; kasıtlı durdurmalar yalnızca kaydedilir. Alarmlar bir durum defteri üzerinden yönetiliyor — bir koşul sürdüğü sürece tekrar tekrar bildirilmez, ancak durumu değişince yeni olay yazılır. Zaman tüneli görünümü aynı anda olan şeyleri yan yana koyar.",
    dikkat:
      "Olaylar saklama süresi dolunca budanır. Bir olayı kalıcı tutmak istiyorsan detayını kopyala. Docker olayları alarmlardan çok daha sık yazıldığı için ayrı ve daha kısa bir saklama süresine tabidir; ikisi de Ayarlar'dan değiştirilir. Bir container'ın olayları bildirim üretmesin istiyorsan compose dosyasına panel.notify=false etiketi yaz — olay yine kaydedilir, yalnızca bildirim gitmez.",
  },

  "/logs": {
    amac: "Container loglarını tek yerde toplayıp arayabilmek. Hangi container'ın ne zaman ne yazdığını, her birine ayrı ayrı bakmadan görürsün.",
    nasil:
      "Arka planda çalışan bir toplayıcı, container loglarını periyodik olarak okuyup veritabanına yazıyor ve her container için nerede kaldığını hatırlıyor — aynı satırlar iki kez toplanmaz.",
    dikkat:
      "Toplama aralıklı çalıştığı için en son saniyeler burada henüz görünmeyebilir. Canlı akış için Docker ekranındaki log sekmesini kullan.",
  },

  "/docker": {
    amac: "Container'ları görmek ve yönetmek: başlat, durdur, yeniden başlat, logları oku, içinde terminal aç. Ayrıca compose yığınları, image, volume ve ağ yönetimi.",
    nasil:
      "Sekmeler: Container, Stack, Image, Volume, Ağ ve Temizlik; her birinde aynı yerde Yenile, Ara ve o sekmenin kendi kapsamıyla Temizle düğmesi var. Container sekmesindeki 'Konteyner Ekle' düğmesi iki başlangıç noktası sunan bir pencere açar: bir compose dosyası eklemek ya da bir image çekmek. İkisi de aynı 'konteyner ayrıntıları' formunu ÖN DOLDURUR (ad, image, portlar, volume'ler, ortam değişkenleri, ağlar, yeniden başlatma politikası) ve her alan düzenlenebilir; hangi yoldan gelinirse gelinsin container yalnızca 'Konteyner oluştur' düğmesine basılınca oluşur — YAML eklemek ya da image çekmek tek başına hiçbir şey ayağa kaldırmaz. Compose dosyasında birden çok servis varsa hangisinden container yapılacağı sorulur; çevrilemeyen port ve volume satırları atlanıp uyarı olarak yazılır. Birbirine bağlı çok servisli bir yığını compose'un kendisiyle kaldırmak için Stack sekmesi durur. Container listesi DÜZ — compose projesine göre gruplanmaz, çünkü compose ile başlatılmış olmak bir uygulamayı yığın yapmaz; yığın bilgisi 'Yığın' sütununda ve Stack sekmesinde. Stack sekmesi compose yığınlarının tek adresi: yığını açınca üyeleri Container sekmesindeki satırın aynısı olarak listelenir, satırda Çek/Uygula/Yeniden başlat/Durdur ve Compose düzenleyici bulunur, yeni yığın da buradan kurulur. Image sekmesinde imaj etiketlenir, etiket kaldırılır ve imaj tar olarak indirilir. Volume sekmesinde oluşturulma tarihi ve yığın sütunları vardır; kullanan container adına tıklamak detayını açar, yığın adına tıklamak Stack sekmesine götürür, 'Dosyaları göster' volume'ün kök dizinini popup içinde listeler. Ağ sekmesi liste görünümünde açılır: ağ oluşturulur, container bağlanır/çıkarılır, ağ çoğaltılır ve silinir; harita görünümü topoloji için durur. Container adına tıklayınca sekmeli bir pencere açılır: Genel, Compose, Ağ, Ortam, Dosyalar, Kaynaklar, Loglar, Terminal ve ham Inspect çıktısı. Compose yığınına ait olmayan container'larda Compose sekmesinin yerine 'Compose üret' sekmesi çıkar: elle ya da docker run ile başlatılmış bir container'dan docker-compose.yml üretir, imajdan devralınan gürültüyü ayıklar ve istersen yeni bir yığın olarak kurar — böylece o container da panelin düzenleyicileriyle yönetilebilir hâle gelir. Satırların başındaki kutularla birden çok container seçilip toplu olarak başlatılabilir, durdurulabilir, yeniden başlatılabilir ya da silinebilir; işlemler sırayla yürür ve sonunda hangisinin geçtiği tek tek yazılır. Yayınlanmış port rozetleri tıklanabilir bağlantıdır. Loglarda ANSI renkleri gösterilir, yazı boyutu değiştirilebilir ve görünen satırlar .txt olarak indirilebilir; terminalde kabuk (bash/sh/zsh/ash) ve kullanıcı oturum başına seçilir. Volume detayından volume klonlanır, tar olarak indirilir ya da dosyalarına göz atılır. Compose sekmesinden port, ağ, ortam değişkeni ve yeniden başlatma politikası düzenlenir; Dosyalar sekmesi container'ın İÇİNDEKİ dosyaları gezer, indirir ve düzenler; Kaynaklar sekmesi CPU, bellek, ağ ve disk grafiklerini gösterir. Tablodaki sütunlar 'Sütunlar' düğmesiyle seçilir (IP, ağ/disk trafiği, çalışma süresi, yığın) ve seçim tarayıcında saklanır; başlıklara tıklayarak sıralanır. Ağlar sekmesindeki harita hangi container'ın hangi ağda olduğunu ve hiçbir ağa bağlı olmayanları gösterir. Uzun container adları tabloda kesilir ve tam adı ipucunda görünür; dar ekranda satırlar karta dönüştüğü için ad tam yazılır. CPU ve bellek ayarlardaki aralıkta ölçülür, tablo canlı Docker çağrısı yapmaz.",
    dikkat:
      "Panelin kendi container'ı ve reverse proxy container'ı toplu işlemlerde SEÇİLEMEZ ve otomatik güncellemeye girmez: panel kendini durdurursa işlem süreç ortasında ölür, proxy durursa panele ulaşan yol kapanır. Bu kilit koda gömülüdür, etiketle açılamaz. Compose ayarlarını değiştirmek container'ı değil, yığının docker-compose.yml dosyasını düzenler — kaydetmeden önce değişikliği satır satır gösterir, yedek alır ve dosya geçersiz çıkarsa geri alır. 'compose up' başarısız olursa yığın DURMUŞ olarak kalır; panel bunu ayrı bir kırmızı bantla söyler ve tek tıkla yedeğe dönmeyi önerir. Bir portu başka bir şey tutuyorsa kaydetme engellenir: o hâliyle yığın kesinlikle başlamaz. Container dosyalarını değiştirmek o uygulamayı ele geçirmekle aynı güçtedir — yazma docker.action izni ister, denetim kaydına düşer, /proc, /sys ve /dev yazmaya kapalıdır ve değişiklikler volume üzerinde değilse container yeniden yaratıldığında kaybolur. Durdurma ve yeniden başlatma hizmet kesintisidir ve onay ister. Ortam değişkenlerinde adı parola/token içerenler maskeli gösterilir ama maskeleme ADA bakar — adı ele vermeyen bir değer de sır olabilir. Compose dosyasına yazılan panel.* etiketleri davranışı değiştirir: panel.update=false güncellemeden, panel.hidden=true listeden, panel.notify=false bildirimlerden çıkarır; panel.url ve panel.port.<port>.url bağlantı adresini belirler, panel.order sırayı, imaja yazılan panel.prune=false ise budamadan korur. Tanınmayan bir değer varsayılana düşer, yani bir yazım hatası container'ı sessizce gizlemez. Volume klonlamak kullanımdaki bir veritabanının dosyalarını o yazarken kopyalayabilir — tutarlı bir kopya için önce container'ı durdur. Volume dışa aktarma arşivi panelin belleğine alır; büyük volume'ler için ayarlardaki sınır geçerlidir ve orada yedekleme motoru (restic) doğru araçtır.",
  },

  "/database": {
    amac: "Sunucudaki veritabanlarına panelden bağlanıp sorgu çalıştırmak, tabloları gezmek ve sonucu dışa aktarmak.",
    nasil:
      "Docker'daki veritabanı container'ları otomatik tanınabilir. LIMIT'i olmayan SELECT'lere otomatik bir satır sınırı eklenir, böylece kazayla yazılmış geniş bir sorgu panelin belleğini yemez.",
    dikkat:
      "Yazma işlemleri varsayılan olarak KAPALIDIR ve bağlantı bazında açılır. WHERE'siz DELETE, DROP ve TRUNCATE ayrıca onay ister. Yazma yetkisi verdiğin bir bağlantıda yaptığın şey geri alınamaz.",
  },

  "/files": {
    amac: "Sunucudaki dosyalara panelden göz atmak, indirmek, yüklemek ve düzenlemek.",
    nasil:
      "Erişim, ayarlarda tanımlı kök dizinlerle sınırlıdır; bu dizinlerin dışına çıkılamaz ve '..' ile yukarı tırmanma engellenir.",
    dikkat:
      "Yetki gerektiren yollara erişim host üzerindeki yardımcı servis üzerinden geçer ve onun izin listesine tabidir. Silme işlemleri geri alınamaz — çöp kutusu yoktur.",
  },

  "/backup": {
    amac: "Panel verisinin ve seçtiğin dizinlerin düzenli yedeklenmesi, yedeklerin listelenmesi ve geri yüklenmesi.",
    nasil:
      "Yedek alınmadan önce veritabanı tutarlı bir noktaya getirilir; istersen yedek sırasında belirli container'lar geçici olarak durdurulur ve sonra geri başlatılır.",
    dikkat:
      "Şifreleme anahtarı (MASTER_KEY) yedeğe BİLEREK dahil edilmez — kaybedersen şifreli ayarlar (token'lar, parolalar) geri getirilemez. Onu panel dışında ayrı bir yerde sakla.",
  },

  "/proxy": {
    amac: "Bir alan adını sunucundaki bir servise yönlendirmek. Böylece 'http://192.168.1.10:8081' yerine 'pihole.local' yazabilirsin. Ayrıca sertifika bitiş takibi ve dinamik DNS.",
    nasil:
      "Panel reverse proxy yapılandırmasını üretip devreye alır. TLS 'kapalı' seçilen kayıtlar düz HTTP portunda, diğerleri HTTPS portunda sunulur — listede her kaydın tam adresi tıklanabilir olarak yazar.",
    dikkat:
      "Alan adının çözülmesi için yerel DNS'ine (ör. Pi-hole) kayıt eklemen gerekir ve alt alan adları tam eşleşmedir. Hedef olarak container adı yazarsan proxy ile aynı Docker ağında olmalı; değilse sunucunun IP'si + yayınlanmış portu kullan. 'Yayını sına' düğmesi bu üç katmanı sırayla dener.",
  },

  "/network": {
    amac: "Yerel ağdaki cihazları keşfetmek, envanterini tutmak, internet hızını ölçmek ve Wake-on-LAN ile makine uyandırmak.",
    nasil:
      "Tarama ayarlarda verdiğin adres aralığında çalışır; bulunan MAC adresleri üretici veritabanıyla eşleştirilerek cihazın ne olduğu tahmin edilir.",
    dikkat:
      "İlk taramada tüm cihazlar 'yeni' görünür ve olay üretebilir. Bilinen cihazları işaretledikten sonra yalnızca gerçekten yeni gelenler dikkat çeker.",
  },

  "/firewall": {
    amac: "Sunucunun güvenlik duvarını (ufw) yönetmek: kural eklemek/silmek, varsayılan gelen-giden politikasını görmek ve güvenlik duvarını açıp kapatmak.",
    nasil:
      "Bütün işlemler host üzerindeki yardımcı servis üzerinden yapılır ve her eylem izin listesinde ayrı ayrı açılır — 'kuralları görebilsin ama değiştiremesin' ya da 'kural ekleyebilsin ama duvarı kapatamasın' böyle ifade edilir. Kural metnini panel yazmaz: formdan üretilen kalıbı host ayrıca doğrular.",
    dikkat:
      "Docker'ın yayınladığı portlara yazılan reddetme kuralları UYGULANMAZ; Docker kendi kurallarını ufw'den önce çalışan bir zincire yazar. Listede 'ufw atlanıyor' rozeti olan satırlar budur. Güvenlik duvarını etkinleştirmeden önce SSH ve panel portu için izin kuralı olduğundan emin ol — panel eksikse uyarır ama onayı sen verirsin.",
  },

  "/ports": {
    amac: "Hangi portu hangi container ya da sistem servisinin tuttuğunu görmek ve yeni bir container'a vereceğin boş portu bulmak.",
    nasil:
      "Tarama, host'un ağ ve PID ad alanına bağlanan geçici bir container açıp /proc/net altındaki soket tablosunu okur; sahibi, sürecin cgroup'undan çözülür — container id'si de systemd birim adı da orada yazar. Sonuç önbelleğe yazılır, ekran her açılışta yeniden taramaz.",
    dikkat:
      "Boş port ararken durmuş container'ların yayınladığı portlar da MEŞGUL sayılır: bugün kimse dinlemiyor olsa da o container başlatıldığında çakışır. Listedeki 'yayınlı' rozeti olan portlar Docker tarafından yayınlanmıştır ve güvenlik duvarı kuralları onlara işlemez.",
  },

  "/security": {
    amac: "Güvenlik duvarı kuralları, açık portlar, SSH anahtarları, başarısız giriş denemeleri ve container image'larındaki bilinen zafiyetler.",
    nasil:
      "Güvenlik duvarı ve fail2ban bilgileri host üzerindeki yardımcı servis aracılığıyla okunur. Zafiyet taraması image'ları tarayan bir araç çalıştırır ve sonucu kaydeder.",
    dikkat:
      "Docker'ın yayınladığı portlar güvenlik duvarını atlar — bir container portu yayınlıyorsa güvenlik duvarında kapalı görünse de dışarıdan erişilebilir olabilir.",
  },

  "/host": {
    amac: "Sunucunun kendisi: konsol, sistem bilgisi, servisler, güç işlemleri, disk ve donanım durumu, compose yığınları.",
    nasil:
      "Bu işlemler container içinden yapılamaz; host üzerinde çalışan küçük bir yardımcı servise imzalı istek gönderilir. Ne çalıştırılabileceğine host tarafındaki izin listesi karar verir ve panel o listeyi değiştiremez. Konsoldaki hazır kalıplarda panel yalnızca bir anahtar yollar — çalışacak komut host tarafında sabittir.",
    dikkat:
      "İzin listesi bilinçli olarak dardır: kapatma, servis yeniden başlatma, compose durdurma ve konsoldaki serbest komut varsayılan olarak KAPALIDIR. Reddedilen bir işlemde panel sana neyin eksik olduğunu söyler. Konsol bir terminal değildir: her komut ayrı çalışır, 'cd' sonraki komutu etkilemez ve etkileşimli komutlar zaman aşımına uğrar.",
  },

  "/users": {
    amac: "Kullanıcılar, roller ve açık oturumlar. Her rolün hangi ekranları görüp hangi işlemleri yapabileceğini buradan belirlersin.",
    nasil:
      "Yetkiler rol üzerinden verilir, kullanıcıya tek tek değil. Bir oturumu buradan sonlandırdığında o cihaz anında dışarı düşer.",
    dikkat:
      "Oturum jetonları veritabanında düz metin tutulmaz, yalnızca özetleri saklanır — bu yüzden mevcut bir oturumun jetonunu görüntülemek mümkün değildir.",
  },

  "/audit": {
    amac: "Panelde kim, ne zaman, neyi yaptı. Değiştiren her işlem buraya düşer.",
    nasil:
      "Kayıt işlemin kendisiyle birlikte yazılır; başarısız denemeler de kaydedilir çünkü 'kim denedi de olmadı' çoğu zaman daha önemlidir.",
    dikkat:
      "Kayıtlar saklama süresi dolunca budanır. Okuma işlemleri (ör. SELECT'ler) gürültü yapmasın diye varsayılan olarak kaydedilmez.",
  },

  "/jobs": {
    amac: "Panelin arka planda çalıştırdığı işler: metrik toplama, yedekleme, sertifika kontrolü, ağ taraması ve diğerleri. Ne zaman çalıştıklarını, son sonuçlarını görür ve elle tetikleyebilirsin.",
    nasil:
      "Her işin zamanlaması ayarlardan gelir, koda gömülü değildir. Aynı iş iki kez birden çalışmasın diye kira tabanlı bir kilit kullanılır; sahibi çökerse kira dolunca iş serbest kalır.",
    dikkat:
      "Sık çalışan işlerin başarılı turları geçmişe yazılmaz — yoksa liste anlamsızlaşırdı. Başarısızlıklar her zaman kaydedilir.",
  },

  "/hostcron": {
    amac: "Sunucunun kendi zamanlanmış görevleri (crontab). Panelin kendi işlerinden ayrıdır; burada host üzerinde çalışan komutları yönetirsin.",
    nasil:
      "Görevler host üzerindeki yardımcı servis aracılığıyla okunur ve yazılır.",
    dikkat:
      "Yıkıcı komut parçaları (ör. 'rm -rf /') panel tarafından reddedilir. Bu bir güvenlik sınırı değil kaza koruması — host'ta root olan zaten istediğini yazabilir.",
  },

  "/settings": {
    amac: "Panelin tüm ayarları. Eşikler, saklama süreleri, çalışma sıklıkları ve entegrasyonlar buradan yönetilir.",
    nasil:
      "Ayarlar veritabanında tutulur ve anında geçerli olur; sunucuyu yeniden başlatmak gerekmez. Her ayarın bir varsayılanı vardır ve 'varsayılana dön' ile geri alınabilir.",
    dikkat:
      "Yalnızca dağıtım parametreleri (portlar, şifreleme anahtarı, docker soketi yolu) .env dosyasındadır ve panelden değiştirilemez.",
  },

  "/hesap": {
    amac: "Kendi hesabın: parola değiştirme ve iki adımlı doğrulama (2FA) kurulumu.",
    nasil:
      "2FA açıldığında girişin ikinci adımında uygulamandaki altı haneli kod istenir. Kurulum sırasında verilen yedek kodlar, telefonunu kaybettiğinde tek giriş yolundur.",
    dikkat:
      "Yedek kodları güvenli bir yere kaydet — bir daha gösterilmezler. Parola değiştirdiğinde diğer oturumların düşmez; onları Kullanıcılar ekranından sonlandırabilirsin.",
  },
};

/**
 * Yol için yardım kaydı — en uzun ön ek kazanır.
 *
 * `/settings/docker` gibi alt yollar da `/settings` kaydını bulsun diye.
 * Kök `/` yalnızca tam eşleşmede kullanılıyor: aksi halde her yolun ön eki
 * olduğu için tüm sayfalar "Genel Bakış" metnini gösterirdi.
 */
export function helpFor(pathname: string): HelpEntry | null {
  if (pathname === "/") return pageHelp["/"] ?? null;

  let best: string | null = null;
  for (const key of Object.keys(pageHelp)) {
    if (key === "/") continue;
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? pageHelp[best] : null;
}
