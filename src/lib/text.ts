/**
 * Arama için metin normalleştirme.
 *
 * Sunucu/istemci ayrımı yok — bilerek: hem komut paletinde (istemci) hem
 * katalog aramasında kullanılıyor ve iki ayrı kopya tutmak, birinin diğerinden
 * sessizce ayrışması demekti.
 *
 * Türkçe'ye özgü harfler NFD ile AYRIŞMIYOR: `ı`, `ş`, `ğ` tek kod noktası ve
 * birleşen bir aksan taşımıyorlar. Bu yüzden diyakritik temizliğinden sonra
 * elle eşleniyorlar — yoksa "sifre" yazan biri "şifre"yi bulamaz.
 */
/**
 * Bir ortam değişkeni adı sır taşıyor mu?
 *
 * Tek yerde duruyor çünkü iki ayrı tüketicisi var: uzak şablonlardan üretilen
 * form alanları (parola kutusu mu olacak) ve container detayındaki ortam
 * değişkeni listesi (değer maskelensin mi). İki ayrı "bu gizli mi" kuralı
 * zamanla ayrışır ve biri sızdırırken diğeri sızdırmaz hâle gelir.
 *
 * Ada bakıyor, değere değil: değerin kendisinden "bu bir parola mı" diye
 * anlamanın güvenilir bir yolu yok ve yanlış tahmin ya gereksiz maskeleme ya
 * da sızıntı demek. Ad tabanlı ölçüt eksik yakalayabilir — bu yüzden detay
 * penceresi hâlâ "değerler parola içerebilir" uyarısını da gösteriyor.
 */
const SECRET_NAME_RE = /PASS|SECRET|TOKEN|KEY|CREDENTIAL|AUTH/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name);
}

export function fold(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    // Kaçış dizisiyle: ham birleşen karakterler kaynak dosyada görünmez ve
    // düzenleyiciler arasında taşınırken sessizce bozulur.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
}
