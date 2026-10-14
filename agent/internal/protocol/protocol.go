// Package protocol — panel-agent protokolü v3, merkezdeki
// src/lib/agent/protocol.ts ile BİREBİR. Ortak test vektörleri
// protocol/vectors-v3.json; iki taraf da aynı dosyaya karşı sınanır.
//
// Taşıma: HTTPS (ajanın kendi sertifikası, merkezde parmak izi sabitlenir)
// + her istekte HMAC imzası. Paylaşılan sır kabloya yazılmaz; imza yöntemi,
// yolu, zamanı ve gövdeyi bağlar, nonce tekrar oynatmayı engeller.
package protocol

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

// Version — merkezdeki AGENT_PROTOCOL. Uyumsuz değişiklikte artar.
const Version = 3

// ClockSkewSeconds — imzanın geçerli sayıldığı saat farkı.
const ClockSkewSeconds = 60

// İstek başlıkları.
const (
	HeaderTS    = "x-agent-ts"
	HeaderNonce = "x-agent-nonce"
	HeaderSig   = "x-agent-sig"
)

// Sha256Hex — gövde özeti (küçük harf onaltılık).
func Sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Canonical — imzalanan metin: METHOD\npath\nts\nnonce\nsha256(body).
func Canonical(method, path, ts, nonce string, body []byte) string {
	return strings.Join([]string{strings.ToUpper(method), path, ts, nonce, Sha256Hex(body)}, "\n")
}

func hmacHex(secret, message string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// Sign — istek imzası.
func Sign(secret, method, path, ts, nonce string, body []byte) string {
	return hmacHex(secret, Canonical(method, path, ts, nonce, body))
}

// VerifyFailure — merkezin beklediği ret kodları ("missing" | "clock" | "replay" | "signature").
type VerifyFailure string

const (
	FailMissing   VerifyFailure = "missing"
	FailClock     VerifyFailure = "clock"
	FailReplay    VerifyFailure = "replay"
	FailSignature VerifyFailure = "signature"
)

var nonceRe = regexp.MustCompile(`^[0-9a-f]{16,64}$`)

// VerifyInput — doğrulanacak isteğin parçaları.
type VerifyInput struct {
	Method, Path, TS, Nonce, Sig string
	Body                         []byte
}

// Verify — imza doğrulaması. `seen` nonce'u kaydeder, görülmüşse false döner.
// Nonce imza doğrulandıktan SONRA kaydedilir: sahte istekler önbelleği
// dolduramasın.
func Verify(secret string, in VerifyInput, now int64, seen func(string) bool) (bool, VerifyFailure) {
	if in.TS == "" || in.Nonce == "" || in.Sig == "" || !nonceRe.MatchString(in.Nonce) {
		return false, FailMissing
	}
	stamp, err := strconv.ParseFloat(in.TS, 64)
	if err != nil || stamp != stamp { // NaN
		return false, FailClock
	}
	if diff := float64(now) - stamp; diff > ClockSkewSeconds || diff < -ClockSkewSeconds {
		return false, FailClock
	}
	expected := Sign(secret, in.Method, in.Path, in.TS, in.Nonce, in.Body)
	if !hmac.Equal([]byte(expected), []byte(in.Sig)) {
		return false, FailSignature
	}
	if !seen(in.Nonce) {
		return false, FailReplay
	}
	return true, ""
}

var nonHex = regexp.MustCompile(`[^0-9a-fA-F]`)

// NormalizeFingerprint — "AA:BB:.." ve "aabb.." aynı değere iner.
func NormalizeFingerprint(value string) string {
	return strings.ToLower(nonHex.ReplaceAllString(value, ""))
}

// EnrollProof — ajan TLS sertifikasının parmak izini sırla imzalar; arada
// duran biri kendi sertifikasını sunabilir ama bu kanıtı üretemez.
func EnrollProof(secret, nonce, fingerprint string) string {
	return hmacHex(secret, "enroll\n"+nonce+"\n"+NormalizeFingerprint(fingerprint))
}
