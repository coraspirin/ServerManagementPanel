package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Ajanın TLS kimliği: ilk açılışta üretilen kendi imzalı sertifika. Güven
// CA'dan değil, merkezin kayıtta sabitlediği parmak izinden gelir; sertifika
// değişirse merkez bağlanmayı reddeder (pinMismatch) ve sunucu yeniden
// eşleştirilir. Bu yüzden dosyalar kalıcı dizinde, yalnız root okur.

// CertPaths — <dir>/cert.pem, <dir>/key.pem.
func CertPaths(dir string) (string, string) {
	return filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
}

// EnsureCert — yoksa üretir, varsa yükler.
func EnsureCert(dir string) (tls.Certificate, error) {
	certPath, keyPath := CertPaths(dir)
	if _, err := os.Stat(certPath); errors.Is(err, os.ErrNotExist) {
		if err := generate(dir, certPath, keyPath); err != nil {
			return tls.Certificate{}, err
		}
	}
	return tls.LoadX509KeyPair(certPath, keyPath)
}

func generate(dir, certPath, keyPath string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return err
	}
	hostname, _ := os.Hostname()
	template := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "panel-agent"},
		DNSNames:              []string{"panel-agent", hostname},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return err
	}
	keyDer, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return err
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDer}), 0o600); err != nil {
		return err
	}
	return os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
}

// Fingerprint — Node'un X509Certificate.fingerprint256 biçimi ("AB:CD:…").
func Fingerprint(cert tls.Certificate) string {
	if len(cert.Certificate) == 0 {
		return ""
	}
	sum := sha256.Sum256(cert.Certificate[0])
	hexed := strings.ToUpper(hex.EncodeToString(sum[:]))
	parts := make([]string, 0, len(sum))
	for i := 0; i < len(hexed); i += 2 {
		parts = append(parts, hexed[i:i+2])
	}
	return strings.Join(parts, ":")
}
