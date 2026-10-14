// Package announce — ajanın merkeze kendini duyurması (Faz B adım 6,
// kararlar.md "Kurulum tek komut").
//
// install-agent.sh `--central URL` verilmişse AGENT_CENTRAL'a yazar. Ajan
// açılınca, merkez onu henüz kaydetmediyse, `POST <central>/api/agent/announce`
// atar: gövde adres/port/parmak izi/sürüm/hostname, imza RPC ile AYNI
// (protocol.Sign, sır AGENT_TOKEN). Merkez bunu bekleyen sunucunun yanında
// "bulundu, onayla" diye gösterir; onayda mevcut enroll çalışır — yani
// sabitleme yine enroll kanıtına dayanır, duyuru yalnız adres önerisidir.
//
// Merkez duyuruyu sır üretildikten sonra 1 saat kabul eder; ajan da o
// kadar (biraz fazlası) dakikada bir dener, sonra susar. İlk doğrulanmış
// merkez isteğinde (`Verified`) durur ve `enrolled` işaretini yazar: sonraki
// açılışlarda duyuru yapılmaz.
package announce

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// Path — merkezdeki uç (src/lib/agent/protocol.ts ANNOUNCE_PATH).
const Path = "/api/agent/announce"

// MarkerName — veri klasöründe "merkez beni kaydetti" işareti.
const MarkerName = "enrolled"

// Payload — src/lib/agent/protocol.ts AgentAnnounce.
type Payload struct {
	Address     string  `json:"address"`
	Port        int     `json:"port"`
	Fingerprint string  `json:"fingerprint"`
	Version     string  `json:"version"`
	Hostname    string  `json:"hostname"`
	OsName      *string `json:"osName"`
}

// Announcer — tek ajan süreci için bir tane.
type Announcer struct {
	Central     string // https://panel.ornek:3000 (yol yok)
	Secret      string
	Port        int
	Fingerprint string
	Version     string
	Hostname    string
	OsName      *string
	// Address — boşsa merkeze giden yolun yerel IP'si (UDP "dial", paket
	// gitmez). NAT arkasında AGENT_ANNOUNCE_ADDRESS ile ezilir.
	Address  string
	DataDir  string
	Client   *http.Client
	Interval time.Duration // varsayılan 60 sn
	Lifetime time.Duration // varsayılan 70 dk (merkez penceresi 60 dk)
	Logf     func(string, ...any)
	Now      func() time.Time

	once sync.Once
	done chan struct{}
}

func (a *Announcer) init() {
	a.once.Do(func() { a.done = make(chan struct{}) })
}

func (a *Announcer) logf(format string, args ...any) {
	if a.Logf != nil {
		a.Logf(format, args...)
	}
}

func (a *Announcer) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}

// Marker — işaret dosyasının yolu.
func (a *Announcer) Marker() string { return filepath.Join(a.DataDir, MarkerName) }

// Enrolled — merkez bu ajana daha önce doğrulanmış istek attı mı.
func (a *Announcer) Enrolled() bool {
	_, err := os.Stat(a.Marker())
	return err == nil
}

// Verified — server.OnVerified: duyuruyu durdurur, işareti yazar (bir kez).
func (a *Announcer) Verified() {
	a.init()
	select {
	case <-a.done:
		return
	default:
		close(a.done)
	}
	if err := os.WriteFile(a.Marker(), []byte(strconv.FormatInt(a.now().Unix(), 10)+"\n"), 0o600); err != nil {
		a.logf("[agent] kayıt işareti yazılamadı: %v", err)
	}
}

// Validate — AGENT_CENTRAL biçimi (http/https, yol yok).
func Validate(central string) (*url.URL, error) {
	parsed, err := url.Parse(central)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, fmt.Errorf("AGENT_CENTRAL http(s)://adres[:port] olmalı: %q", central)
	}
	return parsed, nil
}

// LocalAddress — merkeze giden yolun yerel IP'si.
func LocalAddress(central *url.URL) (string, error) {
	port := central.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443"}[central.Scheme]
	}
	conn, err := net.Dial("udp", net.JoinHostPort(central.Hostname(), port))
	if err != nil {
		return "", err
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String(), nil
}

// Once — tek duyuru. Dönen hata merkezin yanıtını anlatır.
func (a *Announcer) Once(ctx context.Context) error {
	central, err := Validate(a.Central)
	if err != nil {
		return err
	}
	address := a.Address
	if address == "" {
		if address, err = LocalAddress(central); err != nil {
			return fmt.Errorf("yerel adres bulunamadı: %w", err)
		}
	}
	body, err := json.Marshal(Payload{
		Address: address, Port: a.Port, Fingerprint: a.Fingerprint,
		Version: a.Version, Hostname: a.Hostname, OsName: a.OsName,
	})
	if err != nil {
		return err
	}
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return err
	}
	nonce := hex.EncodeToString(nonceBytes)
	ts := strconv.FormatInt(a.now().Unix(), 10)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, central.Scheme+"://"+central.Host+Path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set(protocol.HeaderTS, ts)
	request.Header.Set(protocol.HeaderNonce, nonce)
	request.Header.Set(protocol.HeaderSig, protocol.Sign(a.Secret, http.MethodPost, Path, ts, nonce, body))

	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var reply struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&reply)
	switch response.StatusCode {
	case http.StatusAccepted, http.StatusOK:
		return nil
	case http.StatusNotFound:
		return fmt.Errorf("merkez duyuruyu tanımıyor (404) — panel sürümü eski ya da adres yanlış")
	default:
		return fmt.Errorf("merkez reddetti: HTTP %d %s", response.StatusCode, reply.Error)
	}
}

// Run — kayıt olana, ömür dolana ya da ctx bitene kadar dakikada bir duyurur.
func (a *Announcer) Run(ctx context.Context) {
	a.init()
	if a.Central == "" || a.Enrolled() {
		return
	}
	interval, lifetime := a.Interval, a.Lifetime
	if interval <= 0 {
		interval = time.Minute
	}
	if lifetime <= 0 {
		lifetime = 70 * time.Minute
	}
	deadline := time.NewTimer(lifetime)
	defer deadline.Stop()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	announced := false
	for {
		err := a.Once(ctx)
		switch {
		case err == nil && !announced:
			announced = true
			a.logf("[agent] merkeze duyuruldu (%s) — panelde onay bekleniyor", a.Central)
		case err != nil:
			a.logf("[agent] duyuru başarısız: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-a.done:
			return
		case <-deadline.C:
			a.logf("[agent] duyuru süresi doldu; panelden elle kayıt yapılabilir")
			return
		case <-ticker.C:
		}
	}
}
