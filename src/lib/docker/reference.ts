/**
 * Image referansının parçalanması (M3.39).
 *
 * ## Neden ayrı bir modül
 *
 * Bu mantık ÜÇ yerde kopyalanmıştı: güncelleyicide `splitRef` (M3.28), image
 * listesinde `splitTag` (M3.24) ve yeni etiketleme akışında bir üçüncüsü.
 * Üçünün de çözdüğü aynı ince mesele var:
 *
 * **Son iki nokta son eğik çizgiden ÖNCEYSE etiket değil, kayıt defterinin
 * portudur.** `localhost:5000/app` içindeki `:5000` bir etiket değil; onu
 * etiket sanan bir ayrıştırıcı depo adını `localhost`, etiketi `5000/app`
 * yapar ve `docker tag` çağrısı ya patlar ya da bambaşka bir imaj yaratır.
 *
 * Üç kopyayı ayrı bakımda tutmak, birinde düzeltilen bir hatanın diğer ikisinde
 * yaşamaya devam etmesi demekti.
 *
 * I/O yok, `@/` yolu yok — `node --test` altında doğrudan çalışsın diye saf.
 */

export type ImageReference = { repo: string; tag: string };

/**
 * Referansı depo ve etikete böler; etiket yoksa `latest`.
 *
 * Doğrulama YAPMAZ — var olan bir imajın etiketini okumak için. Kullanıcıdan
 * gelen bir değeri sınamak gerekiyorsa `validReference` kullanılmalı.
 */
export function splitReference(reference: string): ImageReference {
  const text = reference.trim();
  const slash = text.lastIndexOf("/");
  const colon = text.lastIndexOf(":");

  if (colon === -1 || colon < slash) return { repo: text, tag: "latest" };
  return { repo: text.slice(0, colon), tag: text.slice(colon + 1) };
}

/** Depo yolunun bir parçası: küçük harf, rakam ve ayırıcılar. */
const REPO_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/**
 * Kayıt defteri ana bilgisayarı: `ghcr.io`, `localhost:5000`, `reg.ic:443`.
 *
 * Ayrı bir düzenli ifade çünkü depo parçalarının aksine NOKTA ve İKİ NOKTA
 * taşıyabiliyor. Yine de doğrulanıyor: bu değer `docker tag` uç noktasına
 * gidiyor ve `nginx:sürüm/1` gibi bir girdi ana bilgisayar yerine geçip
 * sessizce kabul edilmemeli.
 */
const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:\d{1,5})?$/;

/** İlk parça ana bilgisayar mı, yoksa depo adının kendisi mi. */
function looksLikeHost(part: string): boolean {
  return part.includes(":") || part.includes(".");
}

/**
 * Etiket: harf/rakam/alt çizgi ile başlar, 128 karaktere kadar.
 *
 * Depo adının aksine BÜYÜK harf kabul ediyor — `v1.2-RC1` geçerli bir etiket.
 */
const TAG_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/;

/**
 * Kullanıcıdan gelen referansı doğrular; geçersizse `null`.
 *
 * Sunucuda da çağrılıyor, yalnızca istemcide değil: bu değer `docker tag` uç
 * noktasına parametre olarak gidiyor ve istemciye güvenmek, API token'ıyla
 * gelen bir isteğin denetimsiz kalması demek olurdu.
 */
export function validReference(reference: string): ImageReference | null {
  const text = reference.trim();
  if (!text) return null;

  const { repo, tag } = splitReference(text);
  if (!repo) return null;

  /*
    İlk parça kayıt defteri ana bilgisayarı OLABİLİR (`ghcr.io`,
    `localhost:5000`) ve nokta/iki nokta taşıyor; depo düzenlisini ona
    uygulamak geçerli referansları reddederdi. Bu yüzden ayrı bir düzenliyle
    ama YİNE DE sınanıyor.
  */
  const parcalar = repo.split("/");
  const ilk = parcalar[0];
  const hostVar = parcalar.length > 1 && looksLikeHost(ilk);

  if (hostVar && !HOST_RE.test(ilk)) return null;

  for (const parca of parcalar.slice(hostVar ? 1 : 0)) {
    if (!parca || !REPO_RE.test(parca)) return null;
  }

  if (!TAG_RE.test(tag)) return null;

  return { repo, tag };
}
