package main

// Yönetici komutları (Faz B adım 6): `policy show|profile|allow|deny` ve
// `doctor`. Çıktı Türkçe — host'taki yöneticinin terminali için, kurulum
// betiğiyle aynı dil (native-ajan.md).

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/announce"
	"github.com/coraspirin/servermanagementpanel/agent/internal/docker"
	"github.com/coraspirin/servermanagementpanel/agent/internal/doctor"
	"github.com/coraspirin/servermanagementpanel/agent/internal/helper"
	"github.com/coraspirin/servermanagementpanel/agent/internal/hostinfo"
	"github.com/coraspirin/servermanagementpanel/agent/internal/ops"
	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/server"
	"github.com/coraspirin/servermanagementpanel/agent/internal/update"
)

const policyUsage = `kullanım:
  panel-agent policy show
  panel-agent policy profile readonly|standard|full
  panel-agent policy allow <op|önek.*|helper.<eylem>> [desen]
  panel-agent policy deny  <op|önek.*|helper.<eylem>>`

func policyPath() string { return env("AGENT_POLICY", policy.DefaultPath) }

func runPolicy(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("%s", policyUsage)
	}
	path := policyPath()
	if args[0] == "show" {
		return showPolicy(path)
	}

	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	var next string
	switch {
	case args[0] == "profile" && len(args) == 2:
		next, err = policy.SetProfile(string(content), args[1])
	case args[0] == "allow" && len(args) >= 2:
		next, err = policy.Allow(string(content), args[1], strings.Join(args[2:], " "))
	case args[0] == "deny" && len(args) == 2:
		next, err = policy.Deny(string(content), args[1])
	default:
		return fmt.Errorf("%s", policyUsage)
	}
	if err != nil {
		return err
	}
	if err := policy.WriteFile(path, next); err != nil {
		return err
	}
	fmt.Printf("yazıldı: %s (ajan yeniden başlatmadan uygular)\n\n", path)
	return showPolicy(path)
}

// opNames — ajanın op'ları + sanal izinler (docker.write).
func opNames() []string {
	// Docker ve güncelleyici koşullu kaydedilir; liste için boş örnekler
	// yeter (op'lar çağrılmaz).
	names := ops.New(&ops.Agent{Roots: hostinfo.DefaultRoots(), Docker: &docker.Client{}, Updater: &update.Updater{}}).Names()
	names = append(names, policy.DockerWrite)
	sort.Strings(names)
	return names
}

func showPolicy(path string) error {
	store := &policy.Store{Path: path}
	current, err := store.Current()
	fmt.Printf("dosya:  %s\n", path)
	switch {
	case err != nil:
		fmt.Printf("HATA:   %v — yalnız çekirdek işlemler açık\n", err)
	case current.Source == "":
		fmt.Printf("profil: %s (dosya yok, varsayılan)\n", current.Profile)
	default:
		fmt.Printf("profil: %s\n", current.Profile)
	}

	reasons := map[string]string{"core": "çekirdek", "deny": "deny satırı", "allow": "allow satırı", "profile": "profil"}
	fmt.Println("\nİşlemler:")
	for _, name := range opNames() {
		reason := current.Reason(name)
		mark := "✖"
		if current.Allowed(name) && err == nil || policy.Core[name] {
			mark = "✔"
		}
		label := reasons[reason]
		if label == "" {
			label = "kapalı"
		}
		fmt.Printf("  %s %-22s %s\n", mark, name, label)
	}

	var all []string
	for action := range helper.Actions {
		if helper.RemoteAllowed(action) {
			all = append(all, action)
		}
	}
	sort.Strings(all)
	open := map[string]bool{}
	if err == nil {
		for _, action := range current.HelperActions(all) {
			open[action] = true
		}
	}
	fmt.Println("\nHelper eylemleri (desenli izinler argümana göre ayrıca süzülür):")
	for _, action := range all {
		mark := "✖"
		if open[action] {
			mark = "✔"
		}
		fmt.Printf("  %s %s\n", mark, action)
	}
	return nil
}

// runDoctor — gerçek ortamla doctor.Run.
func runDoctor() bool {
	port, _ := strconv.Atoi(env("AGENT_PORT", "7443"))
	client := &docker.Client{Socket: docker.DefaultSocket()}
	central := env("AGENT_CENTRAL", "")
	results := doctor.Run(context.Background(), doctor.Env{
		Token:      strings.TrimSpace(os.Getenv("AGENT_TOKEN")),
		Port:       port,
		DataDir:    dataDir(),
		PolicyPath: policyPath(),
		Central:    central,
		Service:    env("AGENT_SERVICE", "panel-agent"),
		Geteuid:    os.Geteuid,
		Run: func(name string, args ...string) (string, error) {
			if _, err := exec.LookPath(name); err != nil {
				return "", err
			}
			out, err := exec.Command(name, args...).Output()
			return string(out), err
		},
		CertFingerprint: func() (string, error) {
			certPath, keyPath := server.CertPaths(dataDir())
			cert, err := tls.LoadX509KeyPair(certPath, keyPath)
			if err != nil {
				return "", err
			}
			return server.Fingerprint(cert), nil
		},
		ProbeTLS: func(ctx context.Context, address string) (string, error) {
			// Doğrulama bilerek yok: bu, AYNI makinedeki kendi ajanımıza
			// (127.0.0.1) bakıp sunduğu kendi imzalı sertifikanın parmak izini
			// diskteki ile karşılaştırmak için; bağlantı üzerinden hiçbir veri
			// gönderilmez. Merkezin güveni parmak izi sabitlemesine dayanır.
			dialer := &tls.Dialer{NetDialer: &net.Dialer{Timeout: 3 * time.Second},
				Config: &tls.Config{InsecureSkipVerify: true}}
			conn, err := dialer.DialContext(ctx, "tcp", address)
			if err != nil {
				return "", err
			}
			defer conn.Close()
			state := conn.(*tls.Conn).ConnectionState()
			if len(state.PeerCertificates) == 0 {
				return "", fmt.Errorf("sertifika yok")
			}
			return server.Fingerprint(tls.Certificate{Certificate: [][]byte{state.PeerCertificates[0].Raw}}), nil
		},
		DockerSocket: client.Socket,
		DockerPing: func(ctx context.Context) error {
			ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			reply, err := client.Do(ctx, &docker.Prepared{Method: "GET", Path: "/_ping"})
			if err != nil {
				return err
			}
			if reply.Status != http.StatusOK {
				return fmt.Errorf("HTTP %d", reply.Status)
			}
			return nil
		},
		CentralDate: func(ctx context.Context) (time.Time, error) {
			parsed, err := announce.Validate(central)
			if err != nil {
				return time.Time{}, err
			}
			ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			request, err := http.NewRequestWithContext(ctx, http.MethodHead, parsed.Scheme+"://"+parsed.Host+"/", nil)
			if err != nil {
				return time.Time{}, err
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				return time.Time{}, err
			}
			response.Body.Close()
			return http.ParseTime(response.Header.Get("Date"))
		},
	})
	return doctor.Print(os.Stdout, results)
}
