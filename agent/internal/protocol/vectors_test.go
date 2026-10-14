package protocol

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Ortak vektörler: merkez (Node) ile aynı dosya. Üretici
// scripts/protocol-vectors.ts — burada yalnız okunur.

type vectors struct {
	Protocol         int               `json:"protocol"`
	Headers          map[string]string `json:"headers"`
	ClockSkewSeconds int               `json:"clockSkewSeconds"`
	Sign             []struct {
		Method, Path, Nonce, Body, Secret, TS, BodySha256, Canonical, Sig string
	} `json:"sign"`
	Verify []struct {
		Name, Secret, Method, Path, TS, Nonce, Sig, Body, Expect string
		Now                                                      int64
	} `json:"verify"`
	Fingerprint []struct{ Input, Normalized string }                 `json:"fingerprint"`
	Enroll      []struct{ Secret, Nonce, Fingerprint, Proof string } `json:"enroll"`
	Codec       []struct {
		Name    string          `json:"name"`
		Wire    string          `json:"wire"`
		Decoded json.RawMessage `json:"decoded"`
	} `json:"codec"`
	Rpc struct {
		Request, Response, Error, StreamRequest, StreamError string
		StreamFrames                                         []string
	} `json:"rpc"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "protocol", "vectors-v3.json"))
	if err != nil {
		t.Fatalf("vektör dosyası okunamadı: %v", err)
	}
	var v vectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("vektör dosyası ayrıştırılamadı: %v", err)
	}
	return v
}

func TestSabitler(t *testing.T) {
	v := loadVectors(t)
	if v.Protocol != Version || v.ClockSkewSeconds != ClockSkewSeconds {
		t.Fatalf("protokol %d/%d, saat farkı %d/%d", v.Protocol, Version, v.ClockSkewSeconds, ClockSkewSeconds)
	}
	if v.Headers["ts"] != HeaderTS || v.Headers["nonce"] != HeaderNonce || v.Headers["sig"] != HeaderSig {
		t.Fatalf("başlıklar farklı: %v", v.Headers)
	}
}

func TestImza(t *testing.T) {
	for _, c := range loadVectors(t).Sign {
		if got := Sha256Hex([]byte(c.Body)); got != c.BodySha256 {
			t.Errorf("%s gövde özeti %s ≠ %s", c.Path, got, c.BodySha256)
		}
		if got := Canonical(c.Method, c.Path, c.TS, c.Nonce, []byte(c.Body)); got != c.Canonical {
			t.Errorf("%s kanonik metin farklı:\n%q\n%q", c.Path, got, c.Canonical)
		}
		if got := Sign(c.Secret, c.Method, c.Path, c.TS, c.Nonce, []byte(c.Body)); got != c.Sig {
			t.Errorf("%s imza %s ≠ %s", c.Path, got, c.Sig)
		}
	}
}

func TestDogrulama(t *testing.T) {
	for _, c := range loadVectors(t).Verify {
		ok, reason := Verify(c.Secret, VerifyInput{Method: c.Method, Path: c.Path, TS: c.TS, Nonce: c.Nonce, Sig: c.Sig, Body: []byte(c.Body)}, c.Now, func(string) bool { return true })
		got := string(reason)
		if ok {
			got = "ok"
		}
		if got != c.Expect {
			t.Errorf("%s: %s ≠ %s", c.Name, got, c.Expect)
		}
	}
}

func TestTekrarReddi(t *testing.T) {
	c := loadVectors(t).Verify[0]
	seen := map[string]bool{}
	remember := func(n string) bool {
		if seen[n] {
			return false
		}
		seen[n] = true
		return true
	}
	in := VerifyInput{Method: c.Method, Path: c.Path, TS: c.TS, Nonce: c.Nonce, Sig: c.Sig, Body: []byte(c.Body)}
	if ok, _ := Verify(c.Secret, in, c.Now, remember); !ok {
		t.Fatal("ilk istek reddedildi")
	}
	if ok, reason := Verify(c.Secret, in, c.Now, remember); ok || reason != FailReplay {
		t.Fatalf("tekrar kabul edildi (%v)", reason)
	}
	// Sahte imza nonce önbelleğine yazılmaz.
	bad := in
	bad.Nonce = "ffffffffffffffffffffffffffffffff"
	bad.Sig = "00"
	Verify(c.Secret, bad, c.Now, remember)
	if seen[bad.Nonce] {
		t.Fatal("imzası bozuk isteğin nonce'u kaydedildi")
	}
}

func TestParmakIziVeKayit(t *testing.T) {
	v := loadVectors(t)
	for _, c := range v.Fingerprint {
		if got := NormalizeFingerprint(c.Input); got != c.Normalized {
			t.Errorf("%q → %q ≠ %q", c.Input, got, c.Normalized)
		}
	}
	for _, c := range v.Enroll {
		if got := EnrollProof(c.Secret, c.Nonce, c.Fingerprint); got != c.Proof {
			t.Errorf("kayıt kanıtı %s ≠ %s", got, c.Proof)
		}
	}
}

// descriptor — vektördeki `decoded` ($bytesHex/$dateIso/$undefined) → Go değeri.
func descriptor(t *testing.T, value any) any {
	switch v := value.(type) {
	case []any:
		out := make([]any, len(v))
		for i := range v {
			out[i] = descriptor(t, v[i])
		}
		return out
	case map[string]any:
		if h, ok := v["$bytesHex"].(string); ok {
			data, err := hex.DecodeString(h)
			if err != nil {
				t.Fatal(err)
			}
			return Bytes(data)
		}
		if s, ok := v["$dateIso"].(string); ok {
			d, err := time.Parse(time.RFC3339Nano, s)
			if err != nil {
				t.Fatal(err)
			}
			return Date(d)
		}
		if _, ok := v["$undefined"]; ok {
			return Undefined{}
		}
		out := map[string]any{}
		for key, inner := range v {
			out[key] = descriptor(t, inner)
		}
		return out
	default:
		return v
	}
}

func normalizeBytes(value any) any {
	switch v := value.(type) {
	case Bytes:
		if len(v) == 0 {
			return Bytes{}
		}
		return v
	case Date:
		return time.Time(v).UTC().Format(isoLayout)
	case []any:
		for i := range v {
			v[i] = normalizeBytes(v[i])
		}
		return v
	case map[string]any:
		for key := range v {
			v[key] = normalizeBytes(v[key])
		}
		return v
	default:
		return v
	}
}

func TestCodec(t *testing.T) {
	for _, c := range loadVectors(t).Codec {
		var raw any
		if err := json.Unmarshal(c.Decoded, &raw); err != nil {
			t.Fatal(err)
		}
		want := normalizeBytes(descriptor(t, raw))

		got, err := Decode([]byte(c.Wire))
		if err != nil {
			t.Fatalf("%s: çözülemedi: %v", c.Name, err)
		}
		if !reflect.DeepEqual(normalizeBytes(got), want) {
			t.Errorf("%s: çözüm %#v ≠ %#v", c.Name, got, want)
		}

		// Gidiş-dönüş: Go'nun yazdığı yeniden aynı değere çözülmeli (anahtar
		// sırası JS'ten farklı olabilir, metin değil anlam karşılaştırılır).
		wire, err := Encode(descriptor(t, raw))
		if err != nil {
			t.Fatalf("%s: yazılamadı: %v", c.Name, err)
		}
		again, err := Decode(wire)
		if err != nil {
			t.Fatalf("%s: yeniden çözülemedi: %v (%s)", c.Name, err, wire)
		}
		if !reflect.DeepEqual(normalizeBytes(again), want) {
			t.Errorf("%s: gidiş-dönüş %s", c.Name, wire)
		}
	}
}

func TestRpcOrnekleri(t *testing.T) {
	v := loadVectors(t).Rpc
	req, ok := ParseRpc([]byte(v.Request))
	if !ok || req.Op != "docker.api" || len(req.Args) != 1 {
		t.Fatalf("istek ayrıştırılamadı: %#v", req)
	}
	resp, err := Decode([]byte(v.Response))
	if err != nil {
		t.Fatal(err)
	}
	body := resp.(map[string]any)["value"].(map[string]any)["body"]
	if string(body.(Bytes)) != "[]" {
		t.Fatalf("yanıt gövdesi %#v", body)
	}
	// Hata yanıtı biçimi: Go'nun ürettiği, vektördekiyle aynı anlamda.
	wire, _ := Encode(ErrReply(Errorf("docker-api-denied", "docker-api-denied:denied")))
	a, _ := Decode(wire)
	b, _ := Decode([]byte(v.Error))
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("hata yanıtı %s ≠ %s", wire, v.Error)
	}
	end, _ := Encode(EndFrame())
	if string(end) != v.StreamFrames[len(v.StreamFrames)-1] {
		t.Fatalf("bitiş çerçevesi %s", end)
	}
	errFrame, _ := Encode(ErrFrame(&RpcError{Message: "boom"}))
	if string(errFrame) != v.StreamError {
		t.Fatalf("hata çerçevesi %s ≠ %s", errFrame, v.StreamError)
	}
	// Undefined dönüş değeri alanı düşürür (JS: {"ok":true}).
	if out, _ := Encode(OkReply(Undefined{})); string(out) != `{"ok":true}` {
		t.Fatalf("undefined dönüş %s", out)
	}
}
