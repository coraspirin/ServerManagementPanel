// release-sign — yayın SHA256SUMS dosyasını Ed25519 ile imzalar (CI).
//
//	AGENT_SIGNING_KEY="$(cat key.pem)" go run ./cmd/release-sign dist/SHA256SUMS
//
// Özel anahtar PKCS#8 PEM, yalnız ortam değişkeninden (dosyaya yazılmaz,
// komut satırında görünmez). Çıktı `<dosya>.sig` (base64 ham imza). İmza,
// ajana gömülü ortak anahtarlarla (update.TrustedKeys) hemen doğrulanır:
// yanlış anahtarla imzalanmış bir yayın ajanlarca reddedileceği için CI
// burada durur.
package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"os"

	"github.com/coraspirin/servermanagementpanel/agent/internal/update"
)

func main() {
	if len(os.Args) != 2 {
		fail("kullanım: release-sign <SHA256SUMS>")
	}
	block, _ := pem.Decode([]byte(os.Getenv("AGENT_SIGNING_KEY")))
	if block == nil {
		fail("AGENT_SIGNING_KEY tanımlı değil ya da PEM değil")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		fail("özel anahtar okunamadı: %v", err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		fail("anahtar Ed25519 değil")
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		fail("%v", err)
	}
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(key, data))
	keys, err := update.ParsePublicKeys(update.TrustedKeys)
	if err != nil {
		fail("%v", err)
	}
	if err := update.VerifySums(keys, data, []byte(sig)); err != nil {
		fail("imza gömülü ortak anahtarla doğrulanmadı — yanlış özel anahtar: %v", err)
	}
	if err := os.WriteFile(os.Args[1]+".sig", []byte(sig+"\n"), 0o644); err != nil {
		fail("%v", err)
	}
	fmt.Printf("imzalandı: %s.sig\n", os.Args[1])
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "release-sign: "+format+"\n", args...)
	os.Exit(1)
}
