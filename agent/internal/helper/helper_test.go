package helper

import (
	"context"
	"strings"
	"testing"
)

func allowAll(string, string) (bool, string) { return true, "" }

func TestKomutSablonlari(t *testing.T) {
	cases := []struct {
		action string
		args   Args
		want   string
	}{
		{"power.reboot", Args{"delaySeconds": float64(150)}, "/sbin/shutdown -r +2"},
		{"power.shutdown", Args{}, "/sbin/shutdown -h +0"},
		{"service.restart", Args{"unit": "docker.service"}, "/usr/bin/systemctl restart docker.service"},
		{"journal.read", Args{"sinceSeconds": float64(60), "lines": float64(10)}, "/usr/bin/journalctl --since -60s --lines 10 --output json --no-pager"},
		{"compose.up", Args{"dir": "/opt/stacks/web"}, "/usr/bin/docker compose --project-directory /opt/stacks/web up -d"},
		{"shell.preset", Args{"preset": "apt.upgrade"}, "/usr/bin/apt-get -y -o Dpkg::Options::=--force-confold upgrade"},
		{"shell.exec", Args{"command": "  uname -a "}, "/bin/bash -lc uname -a"},
		{"fail2ban.unban", Args{"jail": "sshd", "ip": "10.0.0.5"}, "/usr/bin/fail2ban-client set sshd unbanip 10.0.0.5"},
	}
	for _, c := range cases {
		argv, err := Actions[c.action](c.args)
		if err != nil || strings.Join(argv, " ") != c.want {
			t.Errorf("%s: %q %v", c.action, strings.Join(argv, " "), err)
		}
	}
}

func TestDogrulayicilar(t *testing.T) {
	bad := []struct {
		action string
		args   Args
		msg    string
	}{
		{"service.restart", Args{"unit": "a b"}, "geçersiz birim adı"},
		{"service.restart", Args{"unit": "x;rm"}, "geçersiz birim adı"},
		{"compose.up", Args{"dir": "/opt/../etc"}, "geçersiz dizin"},
		{"compose.up", Args{"dir": "opt"}, "geçersiz dizin"},
		{"power.reboot", Args{"delaySeconds": float64(-1)}, "delaySeconds 0-86400"},
		{"journal.read", Args{"lines": float64(0)}, "lines 1-50000"},
		{"shell.exec", Args{"command": "a\nb"}, "tek satır"},
		{"shell.exec", Args{"command": strings.Repeat("x", 2001)}, "çok uzun"},
		{"shell.preset", Args{"preset": "rm"}, "bilinmeyen kalıp"},
		{"cron.list", Args{"user": "Root"}, "gecersiz kullanici"},
	}
	for _, c := range bad {
		res := Run(context.Background(), c.action, c.args, "test", allowAll, func(string, ...any) {})
		if res.OK || !strings.HasPrefix(res.Error, "geçersiz argüman: ") || !strings.Contains(res.Error, c.msg) {
			t.Errorf("%s %v: %+v", c.action, c.args, res)
		}
	}
}

// Merkezin ipucu eşlemesi bu sabit parçalara bakıyor (hint.ts helperErrorCode).
func TestHataMetinleriMerkezleUyumlu(t *testing.T) {
	quiet := func(string, ...any) {}
	if res := Run(context.Background(), "yok.boyle", Args{}, "t", allowAll, quiet); !strings.Contains(res.Error, "bilinmeyen eylem") {
		t.Fatalf("bilinmeyen: %+v", res)
	}
	deny := func(string, string) (bool, string) { return false, "action" }
	if res := Run(context.Background(), "power.cancel", Args{}, "t", deny, quiet); res.Error != "eylem izinli değil: power.cancel" {
		t.Fatalf("kapalı: %+v", res)
	}
	pattern := func(string, string) (bool, string) { return false, "pattern" }
	if res := Run(context.Background(), "service.restart", Args{"unit": "x"}, "t", pattern, quiet); !strings.Contains(res.Error, "desene uymuyor") {
		t.Fatalf("desen: %+v", res)
	}
	// Var olmayan ikili: "komut bulunamadı" (Windows'ta da /usr/bin/... yok).
	if res := Run(context.Background(), "power.cancel", Args{}, "t", allowAll, quiet); res.OK || !strings.HasPrefix(res.Error, "komut bulunamadı") && res.ExitCode == nil {
		t.Fatalf("bulunamadı: %+v", res)
	}
}

func TestKonuArguman(t *testing.T) {
	if Subject("compose.up", Args{"dir": "/opt/x", "unit": ""}) != "/opt/x" || Subject("shell.exec", Args{"command": " ls "}) != "ls" || Subject("power.reboot", Args{"unit": "x"}) != "" {
		t.Fatal("ana argüman")
	}
	if !RemoteAllowed("compose.up") || RemoteAllowed("fail2ban.status") || RemoteAllowed("cron.list") {
		t.Fatal("uzak süzgeç Node ajanla aynı olmalı")
	}
}

// Güvenlik incelemesi (2026-10-14): desen, komutta kullanılan argümana
// uygulanmalı — araya sıkıştırılan izinli bir başka anahtar denetimi atlatmasın.
func TestDesenKomuttakiArgumanaUygulanir(t *testing.T) {
	var seen string
	decide := func(action, subject string) (bool, string) {
		seen = subject
		if subject == "/opt/stacks/izinli" {
			return true, ""
		}
		return false, "pattern"
	}
	res := Run(context.Background(), "compose.up", Args{"unit": "/opt/stacks/izinli", "dir": "/etc/kotu", "preset": "/opt/stacks/izinli"}, "t", decide, func(string, ...any) {})
	if res.OK || seen != "/etc/kotu" || !strings.Contains(res.Error, "desene uymuyor") {
		t.Fatalf("desen yanlış argümana uygulandı: subject=%q %+v", seen, res)
	}
}
