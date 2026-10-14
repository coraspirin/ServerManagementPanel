// panel-agent — Sunucu Yönetim Paneli'nin native (Go) ajanı.
//
// Tek statik ikili (CGO yok), host'ta root olarak systemd ile çalışır
// (kararlar.md K1/K3). Merkezle protokol v3'ü konuşur; Node ajanla aynı
// uçlar, aynı imza, aynı codec.
//
//	panel-agent [serve] [-env /etc/panel-agent/agent.env]
//	panel-agent version
//	panel-agent fingerprint [-env …]   sertifika parmak izi (yoksa üretir)
//	panel-agent policy show|profile|allow|deny …   /etc/panel-agent/policy.conf
//	panel-agent doctor [-env …]        kurulum denetimi + düzeltme komutları
//
// Yapılandırma ortam değişkenlerinden (systemd EnvironmentFile ya da -env):
//
//	AGENT_TOKEN   merkezin "sunucu ekle" ekranında verdiği sır (≥32 karakter)
//	AGENT_PORT    7443
//	AGENT_LISTEN  dinlenecek adres (boş = tüm arayüzler)
//	AGENT_DATA    /var/lib/panel-agent (sertifika, raporlar)
//	AGENT_POLICY  /etc/panel-agent/policy.conf
//	AGENT_CENTRAL panel adresi (https://panel:3000) — verilmişse ajan kayıt
//	              olana kadar kendini duyurur (internal/announce)
//	AGENT_ANNOUNCE_ADDRESS  duyuruda bildirilecek adres (NAT; boş = otomatik)
//	REPORTS_DIR   $AGENT_DATA/reports (scripts/hardware.sh çıktısı)
//	DOCKER_SOCKET /var/run/docker.sock
//	HOST_PROC / HOST_SYS / HOST_ROOT_FS   /proc, /sys, / (yalnız deneme için)
package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/announce"
	"github.com/coraspirin/servermanagementpanel/agent/internal/docker"
	"github.com/coraspirin/servermanagementpanel/agent/internal/hostinfo"
	"github.com/coraspirin/servermanagementpanel/agent/internal/i18n"
	"github.com/coraspirin/servermanagementpanel/agent/internal/ops"
	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/server"
	"github.com/coraspirin/servermanagementpanel/agent/internal/update"
)

// version — derlemede -ldflags "-X main.version=…" ile (package.json sürümü).
var version = "dev"

// envFile — `-env` ile verilen dosya (içinde AGENT_TOKEN var; korunur).
var envFile string

// defaultEnvFile — install-agent.sh'ın yazdığı dosya.
const defaultEnvFile = "/etc/panel-agent/agent.env"

func main() {
	log.SetFlags(0)
	command := "serve"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}

	// -env komut argümanlarının arasında da olabilir (`policy show -env X`):
	// Go'nun flag paketi ilk konumsal argümanda durduğu için önce ayıklanır.
	args, envFile = extractEnvFlag(args)
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	_ = flags.String("env", "", "KEY=VALUE satırları içeren ortam dosyası")
	_ = flags.Parse(args)
	// Yönetici komutları -env verilmeden de kurulumun dosyasını okur.
	if envFile == "" && (command == "doctor" || command == "policy") {
		if _, err := os.Stat(defaultEnvFile); err == nil {
			envFile = defaultEnvFile
		}
	}
	if envFile != "" {
		if err := loadEnvFile(envFile); err != nil {
			log.Fatalf("[agent] ortam dosyası okunamadı: %v", err)
		}
	}

	switch command {
	case "version":
		fmt.Println(version)
	case "selftest":
		// Güncellemede yeni ikili bununla denenir: bu mimaride çalışıyor mu,
		// gömülü veriler okunuyor mu. Çıktı yalnız sürüm.
		if err := update.Selftest(version, func() error {
			if !i18n.Has("hardwareLib.noSensors") {
				return fmt.Errorf("gömülü metinler eksik")
			}
			if _, err := policy.Parse("profile standard"); err != nil {
				return err
			}
			_, err := update.ParsePublicKeys(update.TrustedKeys)
			return err
		}); err != nil {
			log.Fatalf("[agent] selftest: %v", err)
		}
	case "fingerprint":
		cert, err := server.EnsureCert(dataDir())
		if err != nil {
			log.Fatalf("[agent] sertifika: %v", err)
		}
		fmt.Println(server.Fingerprint(cert))
	case "policy":
		if err := runPolicy(flags.Args()); err != nil {
			log.Fatalf("%v", err)
		}
	case "doctor":
		if runDoctor() {
			os.Exit(1)
		}
	case "serve":
		if err := serve(); err != nil {
			log.Fatalf("[agent] %v", err)
		}
	default:
		log.Fatalf("bilinmeyen komut %q (serve | version | fingerprint | selftest | policy | doctor)", command)
	}
}

// extractEnvFlag — `-env X`, `--env X`, `-env=X` biçimlerini argümanlardan çıkarır.
func extractEnvFlag(args []string) ([]string, string) {
	var rest []string
	value := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case (arg == "-env" || arg == "--env") && i+1 < len(args):
			value = args[i+1]
			i++
		case strings.HasPrefix(arg, "-env=") || strings.HasPrefix(arg, "--env="):
			value = arg[strings.Index(arg, "=")+1:]
		default:
			rest = append(rest, arg)
		}
	}
	return rest, value
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func dataDir() string { return env("AGENT_DATA", "/var/lib/panel-agent") }

// loadEnvFile — systemd EnvironmentFile biçimi; ortamda zaten olan anahtar
// ezilmez (komut satırından verilen kazanır).
func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

// protectedPaths — ajanın kendi dosyaları: politika klasörü, veri klasörü
// (TLS anahtarı), ikilinin ve env dosyasının klasörleri (AGENT_TOKEN).
// Dosya yöneticisi bunlara `files.roots`'tan bağımsız olarak dokunmaz.
func protectedPaths(policyPath string) []string {
	out := []string{filepath.Dir(policyPath), dataDir(), "/etc/panel-agent"}
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		out = append(out, filepath.Dir(exe))
	}
	if envFile != "" {
		if abs, err := filepath.Abs(envFile); err == nil {
			out = append(out, filepath.Dir(abs))
		}
	}
	// Sembolik bağ üzerinden kurulmuş yollar (ör. /etc/panel-agent → /data/…)
	// çözülmüş hâlleriyle de korunur.
	for _, path := range append([]string(nil), out...) {
		if real, err := filepath.EvalSymlinks(path); err == nil && real != path {
			out = append(out, real)
		}
	}
	for i := range out {
		out[i] = filepath.ToSlash(out[i])
	}
	return out
}

// newUpdater — kendini güncelleme ayarları. AGENT_UPDATE_URL, AGENT_UPDATE_KEYS
// (ek güvenilir anahtar) ve AGENT_UPDATE_CONFIRM_SECONDS yalnız deneme
// kurulumu içindir (env dosyası root'a ait, 0600).
func newUpdater() (*update.Updater, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	keys, err := update.ParsePublicKeys(update.TrustedKeys + "," + os.Getenv("AGENT_UPDATE_KEYS"))
	if err != nil {
		return nil, err
	}
	var window time.Duration
	if seconds, err := strconv.Atoi(os.Getenv("AGENT_UPDATE_CONFIRM_SECONDS")); err == nil && seconds > 0 {
		window = time.Duration(seconds) * time.Second
	}
	return &update.Updater{
		Version:    version,
		Dir:        filepath.Join(dataDir(), "update"),
		Exe:        exe,
		BaseURL:    env("AGENT_UPDATE_URL", update.DefaultBaseURL),
		Keys:       keys,
		Asset:      update.AssetName(),
		Supervised: os.Getenv("INVOCATION_ID") != "",
		Logf:       log.Printf,
		Window:     window,
	}, nil
}

func serve() error {
	secret := strings.TrimSpace(os.Getenv("AGENT_TOKEN"))
	if len(secret) < 32 {
		log.Printf("[agent] AGENT_TOKEN tanımlı değil ya da kısa; merkez bağlanamaz")
	}

	cert, err := server.EnsureCert(dataDir())
	if err != nil {
		return fmt.Errorf("TLS sertifikası: %w", err)
	}

	roots := hostinfo.DefaultRoots()
	agent := &ops.Agent{
		Version:    version,
		Roots:      roots,
		Sampler:    hostinfo.NewSampler(roots),
		ReportsDir: env("REPORTS_DIR", filepath.Join(dataDir(), "reports")),
		Docker:     &docker.Client{Socket: docker.DefaultSocket()},
	}
	policyStore := &policy.Store{Path: env("AGENT_POLICY", policy.DefaultPath)}
	agent.Policy = policyStore
	agent.Protected = protectedPaths(policyStore.Path)
	updater, err := newUpdater()
	if err != nil {
		return err
	}
	agent.Updater = updater
	// Bekleyen güncelleme varsa onay süresini izlemeye başla (yoksa no-op).
	updater.Resume()
	registry := ops.New(agent)
	port, _ := strconv.Atoi(env("AGENT_PORT", "7443"))
	announcer := &announce.Announcer{
		Central:     env("AGENT_CENTRAL", ""),
		Secret:      secret,
		Port:        port,
		Fingerprint: server.Fingerprint(cert),
		Version:     version,
		Hostname:    roots.Hostname(),
		OsName:      roots.OsName(),
		Address:     env("AGENT_ANNOUNCE_ADDRESS", ""),
		DataDir:     dataDir(),
		Logf:        log.Printf,
	}
	srv := &server.Server{
		Secret:      secret,
		Fingerprint: server.Fingerprint(cert),
		Registry:    registry,
		Agent:       agent,
		Policy:      policyStore,
		// İlk doğrulanmış merkez isteği: bekleyen güncellemeyi onaylar,
		// duyuruyu durdurur ("enrolled" işareti).
		OnVerified: func() {
			updater.Confirm()
			announcer.Verified()
		},
	}
	if _, err := srv.Policy.Current(); err != nil {
		log.Printf("[agent] politika dosyası geçersiz, yalnız çekirdek işlemler açık: %v", err)
	}

	address := net.JoinHostPort(env("AGENT_LISTEN", ""), env("AGENT_PORT", "7443"))
	httpServer := &http.Server{
		Addr:              address,
		Handler:           srv.Handler(),
		TLSConfig:         &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// WriteTimeout yok: akışlar (loglar, olaylar) süresiz açık kalır.
		ErrorLog: log.New(os.Stderr, "[agent] http: ", 0),
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if len(secret) >= 32 {
		go announcer.Run(ctx)
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()

	log.Printf("[agent] %s dinleniyor — sürüm %s, parmak izi %s", address, version, srv.Fingerprint)
	if len(secret) >= 32 {
		log.Printf("[agent] hazır — merkezden kayıt bekleniyor")
	}
	if err := httpServer.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
