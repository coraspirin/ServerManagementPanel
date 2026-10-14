// Package i18n — ajanın kullanıcıya dönen metinleri. Kaynak panelin
// src/locales/*.json dosyaları; strings.json `scripts/agent-strings.mjs`
// ile ÜRETİLİR (elle düzenlenmez). Dil, merkezin isteğe eklediği
// `settings["general.language"]`; bilinmeyen dil ve eksik anahtar Türkçeye
// (kaynak dil) düşer — merkezdeki serverT ile aynı.
package i18n

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed strings.json
var raw []byte

var dictionaries map[string]map[string]string

const sourceLocale = "tr"

func init() {
	if err := json.Unmarshal(raw, &dictionaries); err != nil {
		panic(fmt.Sprintf("i18n/strings.json bozuk: %v", err))
	}
}

// Locale — ayarlardan dil kodu; yoksa kaynak dil.
func Locale(settings map[string]any) string {
	if code, ok := settings["general.language"].(string); ok {
		if _, known := dictionaries[code]; known {
			return code
		}
	}
	return sourceLocale
}

// T — anahtarın metni, `{ad}` yer tutucuları doldurulmuş.
func T(locale, key string, params map[string]any) string {
	text, ok := dictionaries[locale][key]
	if !ok {
		text, ok = dictionaries[sourceLocale][key]
	}
	if !ok {
		return key
	}
	for name, value := range params {
		text = strings.ReplaceAll(text, "{"+name+"}", fmt.Sprint(value))
	}
	return text
}

// Has — anahtar kaynak dilde var mı (testler için).
func Has(key string) bool {
	_, ok := dictionaries[sourceLocale][key]
	return ok
}
