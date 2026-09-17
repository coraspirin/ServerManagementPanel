import json
import re
import time
from deep_translator import GoogleTranslator

# 1. Orijinal dosyayı oku
with open("en.json", "r", encoding="utf-8") as f:
    data = json.load(f)

diller = {
    "es": "es.json",
}

AYRAC = " ||| "
BATCH_SIZE = 15  # Google karakter sınırına takılmamak için 15'erli paketler

for lang_kod, dosya_adi in diller.items():
    print(f"\n[{dosya_adi}] başlatılıyor...")
    cevirici = GoogleTranslator(source="en", target=lang_kod)
    yeni_sozluk = {}
    
    # Özel meta alanlarını ayıkla
    islem_listesi = []
    for k, v in data.items():
        if k == "_meta.name":
            yeni_sozluk[k] = lang_kod.upper()
        elif k == "_meta.intl":
            yeni_sozluk[k] = f"{lang_kod}-{lang_kod.upper()}"
        elif isinstance(v, str):
            islem_listesi.append((k, v))
        else:
            yeni_sozluk[k] = v

    toplam = len(islem_listesi)

    for i in range(0, toplam, BATCH_SIZE):
        grup = islem_listesi[i:i + BATCH_SIZE]
        keys = [item[0] for item in grup]
        texts = [item[1] for item in grup]
        
        birlestirilmis = AYRAC.join(texts)
        
        try:
            cevrilmis_blok = cevirici.translate(birlestirilmis)
            parcalar = cevrilmis_blok.split("|||")
            
            # Bölünme uyuşmazlığı kontrolü
            if len(parcalar) == len(texts):
                for k, t in zip(keys, parcalar):
                    temiz = re.sub(r"\{\s*([a-zA-Z0-9_]+)\s*\}", r"{\1}", t.strip())
                    yeni_sozluk[k] = temiz
            else:
                # Blok ayrımı bozulursa tek tek çevir
                for k, t in zip(keys, texts):
                    res = cevirici.translate(t)
                    yeni_sozluk[k] = re.sub(r"\{\s*([a-zA-Z0-9_]+)\s*\}", r"{\1}", res)
        except Exception as e:
            # Hata anında orijinal metni koru
            for k, t in zip(keys, texts):
                yeni_sozluk[k] = t
        
        # İlerleme durumunu göster
        ilerleme = min(i + BATCH_SIZE, toplam)
        print(f"\rİlerleme: {ilerleme}/{toplam} satır tamamlandı (%{int(ilerleme/toplam*100)})", end="", flush=True)
        time.sleep(0.3)  # Rate limit yememek için kısa bekleme

    with open(dosya_adi, "w", encoding="utf-8") as f:
        json.dump(yeni_sozluk, f, indent=2, ensure_ascii=False)
    
    print(f"\n{dosya_adi} kaydedildi.")

print("\nTüm diller başarıyla tamamlandı.")