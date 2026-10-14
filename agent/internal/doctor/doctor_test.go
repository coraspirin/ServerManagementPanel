package doctor

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func healthy(t *testing.T) Env {
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "policy.conf")
	if err := os.WriteFile(policyPath, []byte("profile standard\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	return Env{
		Token: strings.Repeat("x", 40), Port: 7443, DataDir: dir, PolicyPath: policyPath,
		Central: "https://panel.lan", Service: "panel-agent",
		Geteuid: func() int { return 0 },
		Run: func(name string, args ...string) (string, error) {
			if name == "systemctl" {
				return "active\n", nil
			}
			return "yes\n", nil
		},
		CertFingerprint: func() (string, error) { return "AA:BB", nil },
		ProbeTLS:        func(context.Context, string) (string, error) { return "aabb", nil },
		CentralDate:     func(context.Context) (time.Time, error) { return now.Add(2 * time.Second), nil },
		Now:             func() time.Time { return now },
	}
}

func levels(results []Result) map[string]Level {
	out := map[string]Level{}
	for _, r := range results {
		out[r.Title] = r.Level
	}
	return out
}

func TestSaglikliKurulum(t *testing.T) {
	results := Run(context.Background(), healthy(t))
	var buf bytes.Buffer
	if Print(&buf, results) {
		t.Fatalf("sağlıklı kurulum hata verdi:\n%s", buf.String())
	}
	for _, r := range results {
		if r.Level == Warn || r.Level == Fail {
			t.Errorf("beklenmedik: %+v", r)
		}
	}
}

func TestSorunlarVeDuzeltmeler(t *testing.T) {
	env := healthy(t)
	env.Token = "kisa"
	_ = os.WriteFile(env.PolicyPath, []byte("profile ???\n"), 0o644)
	env.ProbeTLS = func(context.Context, string) (string, error) { return "", errors.New("connection refused") }
	env.Run = func(name string, args ...string) (string, error) {
		if name == "systemctl" {
			return "failed\n", errors.New("exit 3")
		}
		return "no\n", nil
	}
	env.CentralDate = func(context.Context) (time.Time, error) { return env.Now().Add(-90 * time.Second), nil }

	results := Run(context.Background(), env)
	got := levels(results)
	for title, want := range map[string]Level{
		"AGENT_TOKEN kısa":              Fail,
		"politika dosyası geçersiz":     Fail,
		"port 7443 dinlenmiyor":         Fail,
		"servis çalışmıyor":             Fail,
		"saat eşitlenmemiş":             Warn,
		"merkezle saat farkı çok büyük": Fail,
	} {
		if got[title] != want {
			t.Errorf("%s: %v, beklenen %v", title, got[title], want)
		}
	}
	for _, r := range results {
		if (r.Level == Fail || r.Level == Warn) && r.Fix == "" {
			t.Errorf("düzeltme komutu yok: %s", r.Title)
		}
	}
	var buf bytes.Buffer
	if !Print(&buf, results) || !strings.Contains(buf.String(), "→ ") {
		t.Fatal("çıktı hata bildirmedi")
	}
}

func TestDockerYoksaBilgi(t *testing.T) {
	env := healthy(t)
	env.DockerSocket = filepath.Join(env.DataDir, "yok.sock")
	if got := levels(Run(context.Background(), env))["Docker yok"]; got != Info {
		t.Fatalf("Docker yokken %v", got)
	}
}

func TestTimedatectlYoksaTimesyncd(t *testing.T) {
	env := healthy(t)
	env.Run = func(name string, args ...string) (string, error) {
		if name == "timedatectl" {
			return "", errors.New("dbus yok")
		}
		if len(args) > 1 && args[1] == "systemd-timesyncd" {
			return "inactive\n", errors.New("exit 3")
		}
		return "active\n", nil
	}
	got := levels(Run(context.Background(), env))
	if got["saat eşitleme servisi çalışmıyor"] != Warn {
		t.Fatalf("timesyncd kapalıyken uyarı yok: %v", got)
	}
}
