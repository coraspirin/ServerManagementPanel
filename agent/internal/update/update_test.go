package update

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Sahte yayın sunucusu: <kök>/<etiket>/{SHA256SUMS,SHA256SUMS.sig,<ikili>}.
func newRelease(t *testing.T, key ed25519.PrivateKey, tag, asset string, binary []byte, tamper func(map[string][]byte)) *httptest.Server {
	t.Helper()
	sum := sha256.Sum256(binary)
	sums := []byte(hex.EncodeToString(sum[:]) + "  " + asset + "\n" + strings.Repeat("0", 64) + "  baska-dosya\n")
	files := map[string][]byte{
		"/" + tag + "/SHA256SUMS":     sums,
		"/" + tag + "/SHA256SUMS.sig": []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(key, sums)) + "\n"),
		"/" + tag + "/" + asset:       binary,
	}
	if tamper != nil {
		tamper(files)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	}))
	t.Cleanup(server.Close)
	return server
}

type harness struct {
	u      *Updater
	exe    string
	exited chan int
}

func newHarness(t *testing.T, base string, key ed25519.PublicKey, selftest string) *harness {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "panel-agent")
	if err := os.WriteFile(exe, []byte("ESKI-IKILI"), 0o755); err != nil {
		t.Fatal(err)
	}
	h := &harness{exe: exe, exited: make(chan int, 4)}
	h.u = &Updater{
		Version: "1.13.1", Dir: filepath.Join(dir, "update"), Exe: exe, BaseURL: base,
		Keys: []ed25519.PublicKey{key}, Asset: "panel-agent-linux-armv7", Supervised: true,
		Exit: func(code int) { h.exited <- code },
		RunSelftest: func(ctx context.Context, path string) (string, error) {
			if selftest == "çöker" {
				return "panic", errors.New("exit status 2")
			}
			return selftest, nil
		},
	}
	return h
}

func waitExit(t *testing.T, h *harness) {
	t.Helper()
	select {
	case <-h.exited:
	case <-time.After(5 * time.Second):
		t.Fatalf("süreç çıkmadı; durum %+v", h.u.Status())
	}
}

func waitPhase(t *testing.T, h *harness, phase string) Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		h.u.mu.Lock()
		running := h.u.running
		h.u.mu.Unlock()
		if status := h.u.Status(); status.Phase == phase && !running {
			return status
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("faz %s olmadı: %+v", phase, h.u.Status())
	return Status{}
}

func keypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func writePending(t *testing.T, dir string, attempts int, deadline time.Time) {
	t.Helper()
	data, _ := json.Marshal(pending{Tag: "v1.14.0", From: "1.13.1", Attempts: attempts, Deadline: deadline.Unix()})
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(filepath.Join(dir, "pending.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestBasariliGuncellemeVeOnay(t *testing.T) {
	pub, priv := keypair(t)
	server := newRelease(t, priv, "v1.14.0", "panel-agent-linux-armv7", []byte("YENI-IKILI"), nil)
	h := newHarness(t, server.URL, pub, "1.14.0")

	if err := h.u.Start("v1.14.0"); err != nil {
		t.Fatal(err)
	}
	waitExit(t, h)
	if data, _ := os.ReadFile(h.exe); string(data) != "YENI-IKILI" {
		t.Fatalf("ikili değişmedi: %s", data)
	}
	if data, _ := os.ReadFile(h.exe + ".prev"); string(data) != "ESKI-IKILI" {
		t.Fatalf("önceki saklanmadı: %s", data)
	}
	if !h.u.hasPending() {
		t.Fatal("bekleyen işaret yok")
	}
	if err := h.u.Start("v1.14.0"); err == nil {
		t.Fatal("bekleyen güncelleme varken ikincisi başladı")
	}

	// Yeni sürüm açılıyor (aynı dizin, yeni süreç) ve merkez bağlanıyor.
	next := newHarness(t, server.URL, pub, "")
	next.u.Dir, next.u.Exe, next.u.Version = h.u.Dir, h.exe, "1.14.0"
	next.u.Resume()
	next.u.Confirm()
	status := next.u.Status()
	if status.Phase != "done" || status.Tag == nil || *status.Tag != "v1.14.0" || next.u.hasPending() {
		t.Fatalf("onay sonrası: %+v", status)
	}
	if !strings.Contains(strings.Join(status.Log, "\n"), "imza doğrulandı") {
		t.Fatalf("günlük: %v", status.Log)
	}
}

func TestReddedilenGuncellemeler(t *testing.T) {
	pub, priv := keypair(t)
	_, otherPriv := keypair(t)
	cases := []struct {
		name     string
		key      ed25519.PrivateKey
		tamper   func(map[string][]byte)
		selftest string
		want     string
	}{
		{"yanlış anahtar", otherPriv, nil, "1.14.0", "imzası doğrulanamadı"},
		{"bozuk özet", priv, func(f map[string][]byte) { f["/v1.14.0/panel-agent-linux-armv7"] = []byte("DEGISMIS") }, "1.14.0", "eşleşmiyor"},
		{"dosya yok", priv, func(f map[string][]byte) { delete(f, "/v1.14.0/panel-agent-linux-armv7") }, "1.14.0", "HTTP 404"},
		{"imza yok", priv, func(f map[string][]byte) { delete(f, "/v1.14.0/SHA256SUMS.sig") }, "1.14.0", "HTTP 404"},
		{"selftest çöker", priv, nil, "çöker", "selftest"},
		{"yanlış sürüm", priv, nil, "1.13.9", "beklenen v1.14.0"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			server := newRelease(t, c.key, "v1.14.0", "panel-agent-linux-armv7", []byte("YENI-IKILI"), c.tamper)
			h := newHarness(t, server.URL, pub, c.selftest)
			if err := h.u.Start("v1.14.0"); err != nil {
				t.Fatal(err)
			}
			status := waitPhase(t, h, "failed")
			if status.Detail == nil || !strings.Contains(*status.Detail, c.want) {
				t.Fatalf("ayrıntı %q ≠ %q", deref(status.Detail), c.want)
			}
			if data, _ := os.ReadFile(h.exe); string(data) != "ESKI-IKILI" {
				t.Fatal("başarısız güncellemede ikili değişti")
			}
			if _, err := os.Stat(h.exe + ".new"); err == nil {
				t.Fatal(".new kaldı")
			}
		})
	}
}

func TestBaslatmaKosullari(t *testing.T) {
	pub, _ := keypair(t)
	h := newHarness(t, "http://127.0.0.1:1", pub, "")
	for tag, want := range map[string]string{
		"1.14.0":  "geçersiz",
		"v1.13.1": "yeni değil",
		"v1.2.0":  "yeni değil",
	} {
		if err := h.u.Start(tag); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: %v", tag, err)
		}
	}
	h.u.Supervised = false
	if err := h.u.Start("v1.14.0"); err == nil || !strings.Contains(err.Error(), "systemd") {
		t.Fatalf("systemd dışı: %v", err)
	}
	h.u.Supervised, h.u.Version = true, "dev"
	if err := h.u.Start("v1.14.0"); err == nil || !strings.Contains(err.Error(), "yayın derlemesi") {
		t.Fatalf("dev derleme: %v", err)
	}
	h.u.Version, h.u.Keys = "1.13.1", nil
	if err := h.u.Start("v1.14.0"); err == nil || !strings.Contains(err.Error(), "imza anahtarı") {
		t.Fatalf("anahtarsız: %v", err)
	}
}

func TestGeriAlma(t *testing.T) {
	pub, _ := keypair(t)
	h := newHarness(t, "", pub, "")
	h.u.Version = "1.14.0"
	reset := func() {
		_ = os.WriteFile(h.exe, []byte("YENI-IKILI"), 0o755)
		_ = os.WriteFile(h.exe+".prev", []byte("ESKI-IKILI"), 0o755)
	}

	// Çökme döngüsü: deneme sınırı aşılınca hemen geri alınır.
	reset()
	writePending(t, h.u.Dir, MaxAttempts, time.Now().Add(time.Hour))
	h.u.Resume()
	waitExit(t, h)
	if data, _ := os.ReadFile(h.exe); string(data) != "ESKI-IKILI" {
		t.Fatalf("geri alınmadı: %s", data)
	}
	if status := h.u.Status(); status.Phase != "rolledBack" || !strings.Contains(*status.Detail, "sınırı") {
		t.Fatalf("durum: %+v", status)
	}

	// Onay süresi dolar: geri alınır.
	reset()
	writePending(t, h.u.Dir, 0, time.Now().Add(200*time.Millisecond))
	h.u.Resume()
	waitExit(t, h)
	if status := h.u.Status(); status.Phase != "rolledBack" || !strings.Contains(*status.Detail, "onay") {
		t.Fatalf("süre dolumu: %+v", status)
	}

	// Süre içinde onay gelirse geri alma YOK.
	reset()
	confirmed := newHarness(t, "", pub, "")
	confirmed.u.Dir, confirmed.u.Exe, confirmed.u.Version = h.u.Dir, h.exe, "1.14.0"
	writePending(t, h.u.Dir, 0, time.Now().Add(200*time.Millisecond))
	confirmed.u.Resume()
	confirmed.u.Confirm()
	time.Sleep(400 * time.Millisecond)
	select {
	case <-confirmed.exited:
		t.Fatal("onaylanmış güncelleme geri alındı")
	default:
	}
	if data, _ := os.ReadFile(h.exe); string(data) != "YENI-IKILI" {
		t.Fatal("onaylı ikili değişti")
	}

	// Eski ikili açılırsa (işaret başka sürümün) işaret temizlenir, geri alma yok.
	writePending(t, h.u.Dir, 0, time.Now().Add(time.Hour))
	old := newHarness(t, "", pub, "")
	old.u.Dir = h.u.Dir
	old.u.Resume()
	if old.u.hasPending() {
		t.Fatal("başka sürümün işareti kalmamalı")
	}
}

func TestImzaVeOzetYardimcilari(t *testing.T) {
	if keys, err := ParsePublicKeys(TrustedKeys); err != nil || len(keys) != 1 {
		t.Fatalf("gömülü anahtar: %v", err)
	}
	if _, err := ParsePublicKeys("kisa"); err == nil {
		t.Fatal("bozuk anahtar kabul edildi")
	}
	upper := "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	if got, err := ExpectedSum([]byte(upper+" *panel-agent-linux-amd64\n"), "panel-agent-linux-amd64"); err != nil || got != strings.ToLower(upper) {
		t.Fatalf("özet: %q %v", got, err)
	}
	if _, err := ExpectedSum([]byte(upper+"  panel-agent-linux-arm64\n"), "panel-agent-linux-amd64"); err == nil {
		t.Fatal("başka mimarinin özeti kabul edildi")
	}
	if !strings.HasPrefix(AssetName(), "panel-agent-linux-") {
		t.Fatal(AssetName())
	}
	if compareVersions("v1.14.0", "1.13.9") != 1 || compareVersions("1.9.0", "1.10.0") != -1 || compareVersions("1.2.3", "v1.2.3") != 0 {
		t.Fatal("sürüm karşılaştırma")
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
