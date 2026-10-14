package announce

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

const secret = "0123456789abcdef0123456789abcdef-test"

// merkez — imzayı merkezle AYNI kuralla doğrular (protocol.Verify, yol Path).
func central(t *testing.T, calls *atomic.Int32, status int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		body, _ := io.ReadAll(r.Body)
		ok, reason := protocol.Verify(secret, protocol.VerifyInput{
			Method: r.Method, Path: r.URL.Path,
			TS: r.Header.Get(protocol.HeaderTS), Nonce: r.Header.Get(protocol.HeaderNonce), Sig: r.Header.Get(protocol.HeaderSig),
			Body: body,
		}, time.Now().Unix(), func(string) bool { return true })
		if !ok {
			t.Errorf("imza geçmedi: %s", reason)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var payload Payload
		if err := json.Unmarshal(body, &payload); err != nil || payload.Port != 7443 || payload.Address != "10.0.0.5" || payload.Hostname != "pi" {
			t.Errorf("gövde beklenmedik: %s", body)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":"x"}`))
	}))
}

func announcer(t *testing.T, url string) *Announcer {
	return &Announcer{
		Central: url, Secret: secret, Port: 7443, Fingerprint: strings.Repeat("ab", 32),
		Version: "1.13.1", Hostname: "pi", Address: "10.0.0.5", DataDir: t.TempDir(),
		Interval: 20 * time.Millisecond, Lifetime: 5 * time.Second,
	}
}

func TestDuyuruImzaliVeKabul(t *testing.T) {
	var calls atomic.Int32
	server := central(t, &calls, http.StatusAccepted)
	defer server.Close()
	if err := announcer(t, server.URL).Once(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("çağrı sayısı %d", calls.Load())
	}
}

func TestDuyuruRetHatasi(t *testing.T) {
	var calls atomic.Int32
	server := central(t, &calls, http.StatusNotFound)
	defer server.Close()
	err := announcer(t, server.URL).Once(context.Background())
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("404 hatası bekleniyordu: %v", err)
	}
}

func TestKayittanSonraSusar(t *testing.T) {
	var calls atomic.Int32
	server := central(t, &calls, http.StatusAccepted)
	defer server.Close()
	a := announcer(t, server.URL)

	finished := make(chan struct{})
	go func() {
		a.Run(context.Background())
		close(finished)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for calls.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	a.Verified()
	a.Verified() // ikinci çağrı no-op
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("Verified sonrası durmadı")
	}
	if !a.Enrolled() {
		t.Fatal("işaret yazılmadı")
	}

	// Sonraki açılış: işaret var → hiç duyurmaz.
	before := calls.Load()
	again := announcer(t, server.URL)
	again.DataDir = a.DataDir
	again.Run(context.Background())
	if calls.Load() != before {
		t.Fatal("kayıtlı ajan yeniden duyurdu")
	}
}

func TestMerkezAdresiDogrulanir(t *testing.T) {
	for _, bad := range []string{"", "panel:3000", "ftp://x", "https://"} {
		if _, err := Validate(bad); err == nil {
			t.Errorf("%q kabul edildi", bad)
		}
	}
	if _, err := Validate("https://panel.lan:3000"); err != nil {
		t.Error(err)
	}
}
