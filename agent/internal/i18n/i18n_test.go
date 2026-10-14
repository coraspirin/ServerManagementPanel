package i18n

import "testing"

func TestMetinler(t *testing.T) {
	if got := T("tr", "hardwareLib.sensorDir", map[string]any{"path": "/sys/class/hwmon"}); got != "Sensör dizini okunamadı (/sys/class/hwmon). /sys mount edilmiş mi?" {
		t.Fatalf("tr: %q", got)
	}
	if got := T("en", "hardwareLib.device.failed", nil); got != "failed" {
		t.Fatalf("en: %q", got)
	}
	// Bilinmeyen dil kaynak dile, bilinmeyen anahtar kendisine düşer.
	if Locale(map[string]any{"general.language": "xx"}) != "tr" || Locale(nil) != "tr" {
		t.Fatal("dil geri dönüşü")
	}
	if T("tr", "yok.boyle", nil) != "yok.boyle" {
		t.Fatal("eksik anahtar")
	}
	// Ajanın kullandığı her anahtar üretilmiş dosyada olmalı.
	for _, key := range []string{
		"hardwareLib.sensorDir", "hardwareLib.sensor", "hardwareLib.device.failed", "hardwareLib.device.spare",
		"hardwareLib.device.active", "hardwareLib.noReport", "hardwareLib.reportInvalid", "hardwareLib.virtual",
		"hardwareLib.noSensors",
	} {
		if !Has(key) {
			t.Errorf("%s yok — node scripts/agent-strings.mjs", key)
		}
	}
}
