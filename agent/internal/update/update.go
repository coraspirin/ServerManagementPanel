// Package update — native ajanın kendini güncellemesi (kararlar.md K5).
//
// Merkez yalnız hedef etiketi söyler (`agent.update ["v1.14.0"]`); ajan
// kendi mimarisinin ikilisini GitHub Releases'ten indirir:
//
//  1. SHA256SUMS + SHA256SUMS.sig indirilir; imza Ed25519 ile ve ajana
//     GÖMÜLÜ ortak anahtarla doğrulanır (özel anahtar yalnız CI'da).
//  2. `panel-agent-linux-<mimari>` indirilir, özeti SHA256SUMS'takiyle eşleşmeli.
//  3. Yeni ikili `selftest` ile çalıştırılır: sürümü hedef etiketle aynı olmalı.
//  4. Eski ikili `<ikili>.prev` olarak saklanır, yeni ikili atomik olarak
//     yerine konur, "bekleyen güncelleme" işareti yazılır ve süreç çıkar —
//     systemd (Restart=always) yeni sürümü başlatır.
//  5. Yeni sürüm açılışta işareti görür: süresi içinde merkezden imzası
//     doğrulanmış bir istek gelirse güncelleme TAMAM; gelmezse ya da süreç
//     üç kez üst üste açılıp onaylanamazsa eski ikili geri konur (geri alma).
//
// `agent.update` / `agent.updateStatus` adları ve dönüş biçimi Node ajanla
// aynı ({phase, tag, detail, at, log}); merkez farkı görmez.
package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultBaseURL — yayın dosyalarının kökü: <kök>/<etiket>/<dosya>.
const DefaultBaseURL = "https://github.com/coraspirin/ServerManagementPanel/releases/download"

// ConfirmWindow — yeni sürümün merkezden onay alması için süre.
const ConfirmWindow = 5 * time.Minute

// MaxAttempts — onaysız açılış sınırı (çökme döngüsü → geri alma).
const MaxAttempts = 3

var releaseTag = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

// Status — merkezdeki UpdateStatus.
type Status struct {
	Phase  string   `json:"phase"` // idle | running | done | failed | rolledBack
	Tag    *string  `json:"tag"`
	Detail *string  `json:"detail"`
	At     *int64   `json:"at"`
	Log    []string `json:"log"`
}

type pending struct {
	Tag      string `json:"tag"`
	From     string `json:"from"`
	Attempts int    `json:"attempts"`
	Deadline int64  `json:"deadline"`
}

type state struct {
	Phase  string `json:"phase"`
	Tag    string `json:"tag"`
	Detail string `json:"detail"`
	At     int64  `json:"at"`
}

// Updater — tek örnek; ajan süreci boyunca yaşar.
type Updater struct {
	Version string
	// Dir — durum, günlük ve işaret dosyaları (AGENT_DATA/update).
	Dir string
	// Exe — çalışan ikilinin yolu (sembolik bağ çözülmüş).
	Exe     string
	BaseURL string
	Keys    []ed25519.PublicKey
	// Asset — bu mimarinin yayın dosyası adı (panel-agent-linux-armv7 …).
	Asset string
	// Supervised — systemd altında mı (yeniden başlatmayı o yapar).
	Supervised bool
	Client     *http.Client
	Now        func() time.Time
	// Exit — yeni ikiliye geçmek için süreçten çıkış (testte değiştirilir).
	Exit func(code int)
	// Logf — journald'a da yazılır.
	Logf func(format string, args ...any)
	// RunSelftest — yeni ikiliyi dener, bildirdiği sürümü döner (testte değiştirilir).
	RunSelftest func(ctx context.Context, path string) (string, error)
	// Window — onay süresi (varsayılan ConfirmWindow).
	Window time.Duration

	mu        sync.Mutex
	running   bool
	confirmed bool
}

// AssetName — `panel-agent-linux-<GOARCH>[v<GOARM>]` (build-agent.sh ile aynı).
func AssetName() string {
	arch := runtime.GOARCH
	if arch == "arm" {
		goarm := "7"
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, setting := range info.Settings {
				if setting.Key == "GOARM" && setting.Value != "" {
					goarm = strings.TrimSuffix(setting.Value, ",softfloat")
				}
			}
		}
		return "panel-agent-linux-armv" + goarm
	}
	return "panel-agent-linux-" + arch
}

// ParsePublicKeys — base64 ham Ed25519 anahtarları (virgüllü).
func ParsePublicKeys(list string) ([]ed25519.PublicKey, error) {
	var out []ed25519.PublicKey
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(item)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("geçersiz ortak anahtar: %q", item)
		}
		out = append(out, ed25519.PublicKey(raw))
	}
	return out, nil
}

func (u *Updater) now() time.Time {
	if u.Now != nil {
		return u.Now()
	}
	return time.Now()
}

func (u *Updater) logf(format string, args ...any) {
	line := fmt.Sprintf("%s %s", u.now().UTC().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
	_ = os.MkdirAll(u.Dir, 0o700)
	if f, err := os.OpenFile(filepath.Join(u.Dir, "update.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
		_, _ = f.WriteString(line + "\n")
		_ = f.Close()
	}
	if u.Logf != nil {
		u.Logf("[update] "+format, args...)
	}
}

func (u *Updater) writeState(phase, tag, detail string) {
	_ = os.MkdirAll(u.Dir, 0o700)
	data, _ := json.Marshal(state{Phase: phase, Tag: tag, Detail: detail, At: u.now().Unix()})
	_ = writeAtomic(filepath.Join(u.Dir, "state.json"), data, 0o600)
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	// Windows'ta hedef o an okunuyorsa yeniden adlandırma paylaşım ihlali
	// verir (Linux'ta vermez); kısa yeniden deneme.
	var err error
	for attempt := 0; attempt < 20; attempt++ {
		if err = os.Rename(tmp, path); err == nil {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return err
}

// Status — agent.updateStatus.
func (u *Updater) Status() Status {
	// Bayrak dosyadan ÖNCE okunur: iş arada biterse dosya son durumu gösterir;
	// tersi sırada "çalışıyor" dosyası + inmiş bayrak "yarıda kaldı" sanılırdı.
	u.mu.Lock()
	running := u.running
	u.mu.Unlock()
	out := Status{Phase: "idle", Log: []string{}}
	if data, err := os.ReadFile(filepath.Join(u.Dir, "state.json")); err == nil {
		var s state
		if json.Unmarshal(data, &s) == nil && s.Phase != "" {
			out.Phase = s.Phase
			if s.Tag != "" {
				out.Tag = &s.Tag
			}
			if s.Detail != "" {
				out.Detail = &s.Detail
			}
			if s.At > 0 {
				out.At = &s.At
			}
		}
	}
	// "Sürüyor" diyen durum ama süreç bu işi yürütmüyor ve bekleyen bir
	// onay yok → yarıda kalmış (ör. host yeniden başladı): başarısız.
	if out.Phase == "running" && !running && !u.hasPending() {
		out.Phase = "failed"
		detail := "güncelleme yarıda kaldı"
		out.Detail = &detail
	}
	if data, err := os.ReadFile(filepath.Join(u.Dir, "update.log")); err == nil {
		lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
		if len(lines) > 40 {
			lines = lines[len(lines)-40:]
		}
		out.Log = lines
	}
	return out
}

// compareVersions — "1.13.1" < "1.14.0".
func compareVersions(a, b string) int {
	pa, pb := strings.Split(strings.TrimPrefix(a, "v"), "."), strings.Split(strings.TrimPrefix(b, "v"), ".")
	for i := 0; i < 3; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

// Start — agent.update. Doğrulama hemen, indirme arka planda.
func (u *Updater) Start(tag string) error {
	if !releaseTag.MatchString(tag) {
		return fmt.Errorf("geçersiz sürüm etiketi: %s", tag)
	}
	if !releaseTag.MatchString("v" + u.Version) {
		return fmt.Errorf("bu ajan bir yayın derlemesi değil (%s); elle güncelleyin", u.Version)
	}
	if compareVersions(tag, u.Version) <= 0 {
		return fmt.Errorf("%s, kurulu sürümden (%s) yeni değil", tag, u.Version)
	}
	if !u.Supervised {
		return errors.New("ajan systemd altında çalışmıyor; kendini yeniden başlatamaz — elle güncelleyin")
	}
	if len(u.Keys) == 0 {
		return errors.New("bu derlemede güncelleme imza anahtarı yok; elle güncelleyin")
	}
	u.mu.Lock()
	if u.running || u.hasPending() {
		u.mu.Unlock()
		return errors.New("bir güncelleme zaten sürüyor")
	}
	u.running = true
	u.mu.Unlock()

	_ = os.Remove(filepath.Join(u.Dir, "update.log"))
	u.writeState("running", tag, "indiriliyor")
	go func() {
		err := u.perform(context.Background(), tag)
		// Önce durum, SONRA bayrak: arada sorulan Status "çalışıyor ama
		// süreç yok → yarıda kaldı" sanmasın.
		if err != nil {
			u.logf("HATA: %v", err)
			u.writeState("failed", tag, err.Error())
		}
		u.mu.Lock()
		u.running = false
		u.mu.Unlock()
	}()
	return nil
}

func (u *Updater) fetch(ctx context.Context, url string, limit int64) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := u.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s: beklenenden büyük", url)
	}
	return data, nil
}

// VerifySums — imza herhangi bir güvenilir anahtarla doğrulanmalı.
func VerifySums(keys []ed25519.PublicKey, sums, sigText []byte) error {
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigText)))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return errors.New("imza dosyası bozuk")
	}
	for _, key := range keys {
		if ed25519.Verify(key, sums, sig) {
			return nil
		}
	}
	return errors.New("SHA256SUMS imzası doğrulanamadı")
}

// ExpectedSum — SHA256SUMS'ta dosyanın özeti (`<hex>  <ad>` ya da `<hex> *<ad>`).
func ExpectedSum(sums []byte, asset string) (string, error) {
	for _, line := range strings.Split(string(sums), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == asset && len(fields[0]) == 64 {
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS'ta %s yok", asset)
}

func (u *Updater) perform(ctx context.Context, tag string) error {
	base := strings.TrimRight(u.BaseURL, "/") + "/" + tag + "/"
	u.logf("hedef %s, dosya %s", tag, u.Asset)

	sums, err := u.fetch(ctx, base+"SHA256SUMS", 1<<20)
	if err != nil {
		return err
	}
	sig, err := u.fetch(ctx, base+"SHA256SUMS.sig", 4096)
	if err != nil {
		return err
	}
	if err := VerifySums(u.Keys, sums, sig); err != nil {
		return err
	}
	u.logf("imza doğrulandı")
	want, err := ExpectedSum(sums, u.Asset)
	if err != nil {
		return err
	}
	binary, err := u.fetch(ctx, base+u.Asset, 200<<20)
	if err != nil {
		return err
	}
	got := sha256.Sum256(binary)
	if hex.EncodeToString(got[:]) != want {
		return errors.New("indirilen ikilinin özeti SHA256SUMS ile eşleşmiyor")
	}
	u.logf("özet doğrulandı (%d bayt)", len(binary))

	next := u.Exe + ".new"
	if err := os.WriteFile(next, binary, 0o755); err != nil {
		return err
	}
	selftestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	runSelftest := u.RunSelftest
	if runSelftest == nil {
		runSelftest = func(ctx context.Context, path string) (string, error) {
			out, err := exec.CommandContext(ctx, path, "selftest").CombinedOutput()
			return strings.TrimSpace(string(out)), err
		}
	}
	reported, err := runSelftest(selftestCtx, next)
	if err != nil {
		_ = os.Remove(next)
		return fmt.Errorf("yeni ikili selftest'ten geçmedi: %v %s", err, reported)
	}
	if reported != strings.TrimPrefix(tag, "v") {
		_ = os.Remove(next)
		return fmt.Errorf("yeni ikili %q sürümünü bildirdi, beklenen %s", reported, tag)
	}
	u.logf("selftest geçti")

	current, err := os.ReadFile(u.Exe)
	if err != nil {
		return err
	}
	if err := writeAtomic(u.Exe+".prev", current, 0o755); err != nil {
		return err
	}
	window := u.Window
	if window <= 0 {
		window = ConfirmWindow
	}
	marker, _ := json.Marshal(pending{Tag: tag, From: u.Version, Deadline: u.now().Add(window).Unix()})
	if err := writeAtomic(filepath.Join(u.Dir, "pending.json"), marker, 0o600); err != nil {
		return err
	}
	if err := os.Rename(next, u.Exe); err != nil {
		_ = os.Remove(filepath.Join(u.Dir, "pending.json"))
		return err
	}
	u.writeState("running", tag, "yeni sürüm başlatılıyor, merkezden onay bekleniyor")
	u.logf("ikili değiştirildi; yeniden başlatılıyor (%s → %s)", u.Version, tag)
	// Yanıt merkeze ulaşsın diye kısa bekleme, sonra çık: systemd yeni
	// ikiliyi başlatır.
	time.Sleep(time.Second)
	u.exit(0)
	return nil
}

func (u *Updater) exit(code int) {
	if u.Exit != nil {
		u.Exit(code)
		return
	}
	os.Exit(code)
}

func (u *Updater) readPending() (*pending, error) {
	data, err := os.ReadFile(filepath.Join(u.Dir, "pending.json"))
	if err != nil {
		return nil, err
	}
	var p pending
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (u *Updater) hasPending() bool {
	_, err := os.Stat(filepath.Join(u.Dir, "pending.json"))
	return err == nil
}

// Resume — açılışta çağrılır. Bekleyen güncelleme varsa deneme sayısını
// artırır; sınır aşıldıysa geri alır, değilse onay süresini izler.
func (u *Updater) Resume() {
	p, err := u.readPending()
	if err != nil {
		return
	}
	if strings.TrimPrefix(p.Tag, "v") != u.Version {
		// İşaret başka bir sürüme ait (ör. geri alma sonrası eski ikili): temizle.
		_ = os.Remove(filepath.Join(u.Dir, "pending.json"))
		return
	}
	p.Attempts++
	data, _ := json.Marshal(p)
	_ = writeAtomic(filepath.Join(u.Dir, "pending.json"), data, 0o600)
	u.logf("yeni sürüm %s açıldı (deneme %d/%d), merkezden onay bekleniyor", p.Tag, p.Attempts, MaxAttempts)
	if p.Attempts > MaxAttempts {
		u.rollback(p, "üst üste açılış sınırı aşıldı")
		return
	}
	deadline := time.Unix(p.Deadline, 0)
	if p.Attempts > 1 {
		// Çöküp yeniden açıldıysa süre yenilenmez ama en az bir dakika verilir.
		if minimum := u.now().Add(time.Minute); deadline.Before(minimum) {
			deadline = minimum
		}
	}
	go func() {
		wait := time.Until(deadline)
		if wait > 0 {
			time.Sleep(wait)
		}
		u.mu.Lock()
		confirmed := u.confirmed
		u.mu.Unlock()
		if !confirmed && u.hasPending() {
			u.rollback(p, "süresi içinde merkezden onay gelmedi")
		}
	}()
}

// Confirm — merkezden imzası doğrulanmış her istekte çağrılır; bekleyen
// güncelleme varsa tamamlar.
func (u *Updater) Confirm() {
	u.mu.Lock()
	if u.confirmed {
		u.mu.Unlock()
		return
	}
	u.confirmed = true
	u.mu.Unlock()
	p, err := u.readPending()
	if err != nil || strings.TrimPrefix(p.Tag, "v") != u.Version {
		return
	}
	_ = os.Remove(filepath.Join(u.Dir, "pending.json"))
	u.logf("merkez yeni sürümle bağlandı — güncelleme tamam (%s)", p.Tag)
	u.writeState("done", p.Tag, "")
}

func (u *Updater) rollback(p *pending, reason string) {
	u.logf("GERİ ALMA: %s — %s'e dönülüyor", reason, p.From)
	prev := u.Exe + ".prev"
	data, err := os.ReadFile(prev)
	if err != nil {
		u.logf("HATA: önceki ikili okunamadı (%v); geri alınamadı", err)
		_ = os.Remove(filepath.Join(u.Dir, "pending.json"))
		u.writeState("failed", p.Tag, reason+"; önceki ikili yok")
		return
	}
	if err := writeAtomic(u.Exe, data, 0o755); err != nil {
		u.logf("HATA: geri alma yazılamadı: %v", err)
		u.writeState("failed", p.Tag, reason)
		return
	}
	_ = os.Remove(filepath.Join(u.Dir, "pending.json"))
	u.writeState("rolledBack", p.Tag, reason)
	u.exit(0)
}

// Selftest — `panel-agent selftest`: sürümü yazar. Yeni ikilinin bu mimaride
// çalışabildiğini ve gömülü verisinin okunabildiğini gösterir.
func Selftest(version string, checks ...func() error) error {
	for _, check := range checks {
		if err := check(); err != nil {
			return err
		}
	}
	fmt.Println(version)
	return nil
}
