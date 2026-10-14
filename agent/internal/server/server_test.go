package server

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/hostinfo"
	"github.com/coraspirin/servermanagementpanel/agent/internal/ops"
	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

const secret = "test-paylasilan-sir-0123456789abcdef0123456789abcdef"

type fixture struct {
	srv    *Server
	http   *httptest.Server
	policy string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dir := t.TempDir()
	cert, err := EnsureCert(filepath.Join(dir, "data"))
	if err != nil {
		t.Fatal(err)
	}
	roots := hostinfo.Roots{Proc: filepath.Join(dir, "proc"), Sys: filepath.Join(dir, "sys"), Root: dir}
	agent := &ops.Agent{Version: "9.9.9", Roots: roots, Sampler: hostinfo.NewSampler(roots), ReportsDir: filepath.Join(dir, "reports")}
	registry := ops.New(agent)
	// Testlik bir akış op'u: iki parça, sonra bitiş; "patla" argümanıyla hata.
	ops.Register(registry, "test.stream", ops.Op{Stream: func(ctx context.Context, req *protocol.RpcRequest, emit func(any) error) error {
		if len(req.Args) > 0 && req.Args[0] == "patla" {
			return errors.New("boom")
		}
		if err := emit(protocol.Bytes("bir")); err != nil {
			return err
		}
		return emit(map[string]any{"n": 2})
	}})
	ops.Register(registry, "power.test", ops.Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		return []any{}, nil
	}})
	f := &fixture{policy: filepath.Join(dir, "policy.conf")}
	f.srv = &Server{
		Secret: secret, Fingerprint: Fingerprint(cert), Registry: registry, Agent: agent,
		Policy: &policy.Store{Path: f.policy}, Logf: func(string, ...any) {},
	}
	f.http = httptest.NewServer(f.srv.Handler())
	t.Cleanup(f.http.Close)
	return f
}

func nonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (f *fixture) post(t *testing.T, path string, body string, mutate func(h http.Header)) (int, string) {
	t.Helper()
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	n := nonce()
	req, _ := http.NewRequest(http.MethodPost, f.http.URL+path, strings.NewReader(body))
	req.Header.Set(protocol.HeaderTS, ts)
	req.Header.Set(protocol.HeaderNonce, n)
	req.Header.Set(protocol.HeaderSig, protocol.Sign(secret, "POST", path, ts, n, []byte(body)))
	if mutate != nil {
		mutate(req.Header)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(data)
}

func decode(t *testing.T, text string) map[string]any {
	t.Helper()
	value, err := protocol.Decode([]byte(text))
	if err != nil {
		t.Fatalf("%v: %s", err, text)
	}
	return value.(map[string]any)
}

func TestHelloVeCekirdekOplar(t *testing.T) {
	f := newFixture(t)
	status, body := f.post(t, "/api/agent/rpc", `{"op":"agent.hello","args":[],"settings":{}}`, nil)
	if status != 200 {
		t.Fatalf("%d %s", status, body)
	}
	hello := decode(t, body)["value"].(map[string]any)
	caps := hello["capabilities"].(map[string]any)
	if hello["protocol"] != float64(3) || hello["version"] != "9.9.9" || caps["native"] != true || caps["dockerRpc"] != false {
		t.Fatalf("hello: %s", body)
	}
	opsList := caps["ops"].([]any)
	if len(opsList) == 0 || opsList[0] != "agent.hello" {
		t.Fatalf("op listesi: %v", opsList)
	}
	for _, op := range []string{"system.info", "metrics.sample", "hardware.report"} {
		status, body := f.post(t, "/api/agent/rpc", `{"op":"`+op+`","args":[],"settings":{}}`, nil)
		if status != 200 || decode(t, body)["ok"] != true {
			t.Fatalf("%s: %d %s", op, status, body)
		}
	}
}

func TestKimlikDogrulama(t *testing.T) {
	f := newFixture(t)
	body := `{"op":"agent.hello","args":[],"settings":{}}`

	if status, text := f.post(t, "/api/agent/rpc", body, func(h http.Header) { h.Set(protocol.HeaderSig, strings.Repeat("0", 64)) }); status != 401 || !strings.Contains(text, `"signature"`) {
		t.Fatalf("bozuk imza: %d %s", status, text)
	}
	old := strconv.FormatInt(time.Now().Unix()-120, 10)
	if status, text := f.post(t, "/api/agent/rpc", body, func(h http.Header) {
		h.Set(protocol.HeaderTS, old)
		h.Set(protocol.HeaderSig, protocol.Sign(secret, "POST", "/api/agent/rpc", old, h.Get(protocol.HeaderNonce), []byte(body)))
	}); status != 401 || !strings.Contains(text, `"clock"`) {
		t.Fatalf("eski zaman: %d %s", status, text)
	}
	// Aynı nonce ikinci kez: replay.
	fixed := nonce()
	same := func(h http.Header) {
		h.Set(protocol.HeaderNonce, fixed)
		h.Set(protocol.HeaderSig, protocol.Sign(secret, "POST", "/api/agent/rpc", h.Get(protocol.HeaderTS), fixed, []byte(body)))
	}
	if status, _ := f.post(t, "/api/agent/rpc", body, same); status != 200 {
		t.Fatal("ilk istek reddedildi")
	}
	if status, text := f.post(t, "/api/agent/rpc", body, same); status != 401 || !strings.Contains(text, `"replay"`) {
		t.Fatalf("tekrar: %d %s", status, text)
	}
	// Başka uca yapılmış imza kabul edilmez (yol imzaya dahil).
	if status, _ := f.post(t, "/api/agent/stream", body, func(h http.Header) {
		h.Set(protocol.HeaderSig, protocol.Sign(secret, "POST", "/api/agent/rpc", h.Get(protocol.HeaderTS), h.Get(protocol.HeaderNonce), []byte(body)))
	}); status != 401 {
		t.Fatalf("yol: %d", status)
	}
	// 60 sn'de 20 hata → kilit.
	for i := 0; i < 20; i++ {
		f.post(t, "/api/agent/rpc", body, func(h http.Header) { h.Set(protocol.HeaderSig, "x") })
	}
	if status, text := f.post(t, "/api/agent/rpc", body, nil); status != 429 || !strings.Contains(text, "locked") {
		t.Fatalf("kilit: %d %s", status, text)
	}
}

func TestBilinmeyenOpVePolitika(t *testing.T) {
	f := newFixture(t)
	status, body := f.post(t, "/api/agent/rpc", `{"op":"docker.list","args":[],"settings":{}}`, nil)
	if status != 404 || decode(t, body)["error"].(map[string]any)["message"] != "unknown-op:docker.list" {
		t.Fatalf("bilinmeyen op: %d %s", status, body)
	}
	if status, body := f.post(t, "/api/agent/rpc", `{"op":1}`, nil); status != 400 || !strings.Contains(body, "bad-request") {
		t.Fatalf("bozuk istek: %d %s", status, body)
	}
	// Akış op'u rpc ucundan çağrılamaz.
	if status, _ := f.post(t, "/api/agent/rpc", `{"op":"test.stream","args":[],"settings":{}}`, nil); status != 404 {
		t.Fatalf("tür: %d", status)
	}

	// Varsayılan (standard) profil: güç işleri kapalı (yalnız full).
	status, body = f.post(t, "/api/agent/rpc", `{"op":"power.test","args":["/"],"settings":{}}`, nil)
	if status != 200 || decode(t, body)["error"].(map[string]any)["code"] != "policy-denied" {
		t.Fatalf("politika reddi: %d %s", status, body)
	}
	// Host açıkça izin verince çalışır — yeniden başlatmadan.
	if err := os.WriteFile(f.policy, []byte("profile standard\nallow power.*\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if status, body := f.post(t, "/api/agent/rpc", `{"op":"power.test","args":["/"],"settings":{}}`, nil); decode(t, body)["ok"] != true {
		t.Fatalf("izin sonrası: %d %s", status, body)
	}
	// Bozuk politika: yalnız çekirdek op'lar.
	if err := os.WriteFile(f.policy, []byte("profile hepsi\n# mtime farklı olsun\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, body := f.post(t, "/api/agent/rpc", `{"op":"power.test","args":["/"],"settings":{}}`, nil); decode(t, body)["error"].(map[string]any)["code"] != "policy-invalid" {
		t.Fatalf("bozuk politika: %s", body)
	}
	if _, body := f.post(t, "/api/agent/rpc", `{"op":"agent.hello","args":[],"settings":{}}`, nil); decode(t, body)["ok"] != true {
		t.Fatalf("çekirdek op bozuk politikada da açık olmalı: %s", body)
	}
}

func TestAkis(t *testing.T) {
	f := newFixture(t)
	_ = os.WriteFile(f.policy, []byte("allow test.*\n"), 0o644)
	status, body := f.post(t, "/api/agent/stream", `{"op":"test.stream","args":[],"settings":{}}`, nil)
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if status != 200 || len(lines) != 3 {
		t.Fatalf("%d %q", status, body)
	}
	first := decode(t, lines[0])
	if first["t"] != "d" || string(first["d"].(protocol.Bytes)) != "bir" || lines[2] != `{"t":"end"}` {
		t.Fatalf("çerçeveler: %q", lines)
	}
	_, body = f.post(t, "/api/agent/stream", `{"op":"test.stream","args":["patla"],"settings":{}}`, nil)
	if strings.TrimSpace(body) != `{"t":"err","e":{"message":"boom"}}` {
		t.Fatalf("hata çerçevesi: %q", body)
	}
}

func TestKayit(t *testing.T) {
	f := newFixture(t)
	n := nonce() + nonce()
	status, body := f.post(t, "/api/agent/enroll", `{"nonce":"`+n+`"}`, nil)
	if status != 200 {
		t.Fatalf("%d %s", status, body)
	}
	var reply struct {
		Fingerprint string         `json:"fingerprint"`
		Proof       string         `json:"proof"`
		Hello       map[string]any `json:"hello"`
	}
	if err := json.Unmarshal([]byte(body), &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Fingerprint != f.srv.Fingerprint || reply.Proof != protocol.EnrollProof(secret, n, f.srv.Fingerprint) || reply.Hello["protocol"] != float64(3) {
		t.Fatalf("kayıt: %s", body)
	}
	if status, _ := f.post(t, "/api/agent/enroll", `{"nonce":"KISA"}`, nil); status != 400 {
		t.Fatalf("bozuk nonce: %d", status)
	}
}

// TLS: istemcinin gördüğü sertifikanın parmak izi, kayıtta bildirilenle aynı
// (merkezin sabitlediği değer budur).
func TestTLSParmakIzi(t *testing.T) {
	dir := t.TempDir()
	cert, err := EnsureCert(dir)
	if err != nil {
		t.Fatal(err)
	}
	again, err := EnsureCert(dir)
	if err != nil || Fingerprint(again) != Fingerprint(cert) {
		t.Fatal("sertifika yeniden açılışta değişmemeli")
	}
	if fp := Fingerprint(cert); len(fp) != 95 || strings.ToUpper(fp) != fp {
		t.Fatalf("biçim: %s", fp)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
	server.StartTLS()
	defer server.Close()
	conn, err := tls.Dial("tcp", server.Listener.Addr().String(), &tls.Config{InsecureSkipVerify: true}) // merkez de CA'ya değil parmak izine güvenir
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	seen := Fingerprint(tls.Certificate{Certificate: [][]byte{conn.ConnectionState().PeerCertificates[0].Raw}})
	if seen != Fingerprint(cert) {
		t.Fatalf("%s ≠ %s", seen, Fingerprint(cert))
	}
}
