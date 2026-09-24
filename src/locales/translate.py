import json
import os
import re
import sys
import deepl

# Anahtar koda yazılmaz: DEEPL_API_KEY ortam değişkeninden okunur.
#   PowerShell: $env:DEEPL_API_KEY = "..."; python translate.py
DEEPL_API_KEY = os.environ.get("DEEPL_API_KEY", "").strip()
if not DEEPL_API_KEY:
    sys.exit("DEEPL_API_KEY ortam değişkeni tanımlı değil.")
translator = deepl.Translator(DEEPL_API_KEY)

with open("en.json", "r", encoding="utf-8") as f:
    data = json.load(f)

diller = {

    # Yaygın Avrupa Dilleri
    "FR": {"dosya": "fr.json", "meta_name": "Français", "meta_intl": "fr-FR"},
    #"IT": {"dosya": "it.json", "meta_name": "Italiano", "meta_intl": "it-IT"},
    #"ES": {"dosya": "es.json", "meta_name": "Español", "meta_intl": "es-ES"},

    # Asya ve Uzak Doğu Dilleri
    #"JA": {"dosya": "ja.json", "meta_name": "日本語", "meta_intl": "ja-JP"},
    #"KO": {"dosya": "ko.json", "meta_name": "한국어", "meta_intl": "ko-KR"},
    #"ZH": {"dosya": "zh.json", "meta_name": "简体中文", "meta_intl": "zh-CN"},
}

def degiskenleri_kilitle(metin):
    """
    {host}, {days} gibi kalıpları bulur ve bunları
    __VAR_0__, __VAR_1__ gibi dokunulmaz kodlarla değiştirir.
    """
    eslesmeler = re.findall(r"\{[a-zA-Z0-9_.]+\}", metin)
    yedek_harita = {}
    kilitli_metin = metin
    
    for i, kalip in enumerate(eslesmeler):
        kod = f"__VAR_{i}__"
        yedek_harita[kod] = kalip
        # Sadece ilk eşleşeni sırayla değiştir
        kilitli_metin = kilitli_metin.replace(kalip, kod, 1)
        
    return kilitli_metin, yedek_harita

def degiskenleri_coz(metin, yedek_harita):
    """
    __VAR_0__ gibi kodları orijinal {host}, {days} hallerine geri döndürür.
    """
    cozulmus = metin
    for kod, orijinal in yedek_harita.items():
        # Olası boşluk bozulmalarını da yakalar (__VAR_0__ veya __ VAR_0 __)
        desen = re.compile(re.escape(kod).replace(r"\_", r"\s*_\s*"), re.IGNORECASE)
        cozulmus = desen.sub(orijinal, cozulmus)
        # Doğrudan eşleşme
        cozulmus = cozulmus.replace(kod, orijinal)
    return cozulmus

for lang_kod, ayar in diller.items():
    print(f"\n[{ayar['dosya']}] çevirisi yapılıyor...")
    yeni_sozluk = {}
    
    keys_to_translate = []
    texts_to_translate = []
    maps_list = []
    
    for k, v in data.items():
        if k == "_meta.name":
            yeni_sozluk[k] = ayar["meta_name"]
        elif k == "_meta.intl":
            yeni_sozluk[k] = ayar["meta_intl"]
        elif isinstance(v, str):
            kilitli, harita = degiskenleri_kilitle(v)
            keys_to_translate.append(k)
            texts_to_translate.append(kilitli)
            maps_list.append(harita)
        else:
            yeni_sozluk[k] = v

    BATCH_SIZE = 40
    toplam = len(texts_to_translate)
    
    for i in range(0, toplam, BATCH_SIZE):
        batch_keys = keys_to_translate[i:i + BATCH_SIZE]
        batch_texts = texts_to_translate[i:i + BATCH_SIZE]
        batch_maps = maps_list[i:i + BATCH_SIZE]
        
        try:
            results = translator.translate_text(
                batch_texts,
                source_lang="EN",
                target_lang=lang_kod,
                preserve_formatting=True
            )
            
            for k, res, h in zip(batch_keys, results, batch_maps):
                yeni_sozluk[k] = degiskenleri_coz(res.text, h)

        except Exception as e:
            print(f"\nHata oluştu: {e}")
            for k, t, h in zip(batch_keys, batch_texts, batch_maps):
                yeni_sozluk[k] = degiskenleri_coz(t, h)

        ilerleme = min(i + BATCH_SIZE, toplam)
        print(f"\rİlerleme: {ilerleme}/{toplam} (%{int(ilerleme/toplam*100)})", end="", flush=True)

    with open(ayar["dosya"], "w", encoding="utf-8") as f:
        json.dump(yeni_sozluk, f, indent=2, ensure_ascii=False)
        
    print(f"\n{ayar['dosya']} başarıyla kaydedildi.")

print("\nTüm dosyalar eksiksiz tamamlandı!")