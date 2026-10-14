// Package doctor — `panel-agent doctor` (Faz B adım 6, kararlar.md: "her
// sorun için düzeltme komutu"). Kurulumun sağlığını tek tek denetler ve her
// sorunun yanına çalıştırılacak komutu yazar.
//
// Dış dünya (systemctl, soket, ağ, saat) Env'deki işlevlerle verilir:
// testler sahtelerini geçer, main gerçeklerini.
//
// Çıktı Türkçe: host'ta yöneticinin terminali için, install-agent.sh ile
// aynı dilde (panel arayüzü değil; i18n kapsamı dışında, native-ajan.md).
package doctor

import (
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// Level — sonucun ağırlığı.
type Level int

const (
	OK Level = iota
	Info
	Warn
	Fail
)

// Result — tek denetim.
type Result struct {
	Level  Level
	Title  string
	Detail string
	Fix    string
}

// Env — denetimlerin girdileri.
type Env struct {
	Token      string
	Port       int
	DataDir    string
	PolicyPath string
	Central    string
	Service    string // systemd birimi (panel-agent)

	Geteuid func() int
	// Run — komut çalıştırır (systemctl, timedatectl); yoksa hata.
	Run func(name string, args ...string) (string, error)
	// CertFingerprint — diskteki sertifikanın parmak izi; yoksa hata.
	CertFingerprint func() (string, error)
	// ProbeTLS — çalışan ajanın sunduğu sertifikanın parmak izi.
	ProbeTLS func(ctx context.Context, address string) (string, error)
	// DockerSocket yoksa Docker denetimi bilgi olarak geçer.
	DockerSocket string
	DockerPing   func(ctx context.Context) error
	// CentralDate — merkezin HTTP Date başlığı (ulaşılabilirlik + saat).
	CentralDate func(ctx context.Context) (time.Time, error)
	Now         func() time.Time
}

func ok(title, detail string) Result { return Result{Level: OK, Title: title, Detail: detail} }

// Run — tüm denetimler, sırayla.
func Run(ctx context.Context, env Env) []Result {
	var out []Result
	add := func(r Result) { out = append(out, r) }

	if env.Geteuid != nil && env.Geteuid() != 0 {
		add(Result{Level: Warn, Title: "root değil", Detail: "bazı denetimler (sertifika, veri klasörü) okunamayabilir", Fix: "sudo panel-agent doctor"})
	}

	// 1. Sır
	switch {
	case env.Token == "":
		add(Result{Level: Fail, Title: "AGENT_TOKEN yok", Detail: "merkez bu ajana bağlanamaz",
			Fix: "panelde Sunucular → bu sunucu → anahtar simgesi (yeni token), sonra: install-agent.sh --token <TOKEN>"})
	case len(env.Token) < 32:
		add(Result{Level: Fail, Title: "AGENT_TOKEN kısa", Detail: fmt.Sprintf("%d karakter, en az 32", len(env.Token)),
			Fix: "panelden yeni token alıp install-agent.sh --token <TOKEN> ile yeniden kurun"})
	default:
		add(ok("AGENT_TOKEN tanımlı", ""))
	}

	// 2. Politika
	store := &policy.Store{Path: env.PolicyPath}
	if current, err := store.Current(); err != nil {
		add(Result{Level: Fail, Title: "politika dosyası geçersiz", Detail: err.Error() + " — yalnız çekirdek işlemler açık",
			Fix: "dosyayı düzeltin: " + env.PolicyPath + " (ya da: panel-agent policy profile standard)"})
	} else if current.Source == "" {
		add(Result{Level: Info, Title: "politika dosyası yok", Detail: "varsayılan profil: " + current.Profile,
			Fix: "panel-agent policy profile standard"})
	} else {
		add(ok("politika: "+current.Profile, env.PolicyPath))
	}

	// 3. Sertifika + dinleyen süreç
	var diskFP string
	if env.CertFingerprint != nil {
		fp, err := env.CertFingerprint()
		if err != nil {
			add(Result{Level: Fail, Title: "TLS sertifikası okunamadı", Detail: err.Error(),
				Fix: "systemctl restart " + env.Service + " (ilk açılışta üretilir); izin: ls -l " + env.DataDir})
		} else {
			diskFP = fp
			add(ok("TLS sertifikası", fp))
		}
	}
	if env.ProbeTLS != nil {
		address := fmt.Sprintf("127.0.0.1:%d", env.Port)
		fp, err := env.ProbeTLS(ctx, address)
		switch {
		case err != nil:
			add(Result{Level: Fail, Title: fmt.Sprintf("port %d dinlenmiyor", env.Port), Detail: err.Error(),
				Fix: "systemctl status " + env.Service + "; journalctl -u " + env.Service + " -n 50"})
		case diskFP != "" && protocol.NormalizeFingerprint(fp) != protocol.NormalizeFingerprint(diskFP):
			add(Result{Level: Warn, Title: "çalışan ajanın sertifikası diskteki ile farklı", Detail: fp,
				Fix: "systemctl restart " + env.Service + " — sonra panelden yeniden bağlanın (parmak izi değişti)"})
		default:
			add(ok(fmt.Sprintf("port %d dinleniyor", env.Port), ""))
		}
	}

	// 4. systemd
	if env.Run != nil && env.Service != "" {
		if state, err := env.Run("systemctl", "is-active", env.Service); err != nil && state == "" {
			add(Result{Level: Info, Title: "systemd denetlenemedi", Detail: err.Error()})
		} else if strings.TrimSpace(state) != "active" {
			add(Result{Level: Fail, Title: "servis çalışmıyor", Detail: env.Service + ": " + strings.TrimSpace(state),
				Fix: "systemctl enable --now " + env.Service + "; journalctl -u " + env.Service + " -n 50"})
		} else {
			add(ok("servis çalışıyor", env.Service))
		}
	}

	// 5. Docker
	if env.DockerSocket != "" {
		if _, err := os.Stat(env.DockerSocket); err != nil {
			add(Result{Level: Info, Title: "Docker yok", Detail: "Docker özellikleri bu sunucuda kapalı (" + env.DockerSocket + ")"})
		} else if env.DockerPing != nil {
			if err := env.DockerPing(ctx); err != nil {
				add(Result{Level: Warn, Title: "Docker yanıt vermiyor", Detail: err.Error(),
					Fix: "systemctl status docker; systemctl restart docker"})
			} else {
				add(ok("Docker erişilebilir", env.DockerSocket))
			}
		}
	}

	// 6. Saat eşitlemesi
	if env.Run != nil {
		const fix = "timedatectl set-ntp true  (DietPi: /boot/dietpi/func/dietpi-set_software ntpd-mode 4)"
		if value, err := env.Run("timedatectl", "show", "-p", "NTPSynchronized", "--value"); err == nil {
			if strings.TrimSpace(value) == "yes" {
				add(ok("saat eşitlenmiş (NTP)", ""))
			} else {
				add(Result{Level: Warn, Title: "saat eşitlenmemiş", Detail: "fark 60 sn'yi aşarsa merkezin istekleri reddedilir", Fix: fix})
			}
		} else if state, err := env.Run("systemctl", "is-active", "systemd-timesyncd"); strings.TrimSpace(state) == "active" {
			// timedatectl dbus ister; dbus'sız sistemlerde (DietPi) servise bakılır.
			add(ok("saat eşitleme servisi çalışıyor (systemd-timesyncd)", ""))
		} else if err != nil && state == "" {
			add(Result{Level: Info, Title: "saat eşitlemesi denetlenemedi", Detail: "timedatectl ve systemctl yanıt vermedi"})
		} else {
			add(Result{Level: Warn, Title: "saat eşitleme servisi çalışmıyor", Detail: "systemd-timesyncd: " + strings.TrimSpace(state) + " — fark 60 sn'yi aşarsa merkezin istekleri reddedilir", Fix: fix})
		}
	}

	// 7. Merkez (duyuru adresi verildiyse)
	if env.Central != "" && env.CentralDate != nil {
		date, err := env.CentralDate(ctx)
		if err != nil {
			add(Result{Level: Warn, Title: "merkeze ulaşılamıyor", Detail: env.Central + ": " + err.Error(),
				Fix: "adresi denetleyin (AGENT_CENTRAL, " + filepath.Join("/etc/panel-agent", "agent.env") + "); duyurusuz da panelden elle kayıt olur"})
		} else {
			skew := math.Abs(env.now().Sub(date).Seconds())
			level, title := OK, "merkeze ulaşılıyor"
			if skew > float64(protocol.ClockSkewSeconds) {
				level, title = Fail, "merkezle saat farkı çok büyük"
			} else if skew > 5 {
				level, title = Warn, "merkezle saat farkı var"
			}
			r := Result{Level: level, Title: title, Detail: fmt.Sprintf("%s, fark %.0f sn", env.Central, skew)}
			if level != OK {
				r.Fix = "timedatectl set-ntp true"
			}
			add(r)
		}
	}
	if env.DataDir != "" {
		if _, err := os.Stat(filepath.Join(env.DataDir, "enrolled")); err == nil {
			add(ok("merkez bu ajanı kaydetmiş", ""))
		} else if env.Central != "" {
			add(Result{Level: Info, Title: "henüz kayıtlı değil", Detail: "ajan merkeze kendini duyuruyor; panelde Sunucular ekranından onaylayın"})
		} else {
			add(Result{Level: Info, Title: "henüz kayıtlı değil", Detail: "panelde Sunucular → bu sunucu → bağlan (adres https://<ip>:" + fmt.Sprint(env.Port) + ")"})
		}

		// 8. Güncelleme klasörü yazılabilir mi
		probe := filepath.Join(env.DataDir, ".doctor-write")
		if err := os.WriteFile(probe, []byte("x"), 0o600); err != nil {
			add(Result{Level: Fail, Title: "veri klasörü yazılamıyor", Detail: err.Error(),
				Fix: "install -d -m 700 " + env.DataDir})
		} else {
			_ = os.Remove(probe)
		}
	}
	return out
}

func (e Env) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

var marks = map[Level]string{OK: "✔", Info: "•", Warn: "⚠", Fail: "✖"}

// Print — sonuçları yazar; Fail varsa true.
func Print(w io.Writer, results []Result) bool {
	failed := false
	for _, r := range results {
		line := marks[r.Level] + " " + r.Title
		if r.Detail != "" {
			line += " — " + r.Detail
		}
		fmt.Fprintln(w, line)
		if r.Fix != "" {
			fmt.Fprintln(w, "    → "+r.Fix)
		}
		if r.Level == Fail {
			failed = true
		}
	}
	return failed
}
