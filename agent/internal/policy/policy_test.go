package policy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestKararSirasi(t *testing.T) {
	p, err := Parse(`
# yorum
profile standard
allow files.*   # dosya işlemleri
allow host.accounts
deny  files.remove
`)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]bool{
		"agent.hello":     true,  // çekirdek
		"metrics.sample":  true,  // çekirdek
		"files.list":      true,  // allow files.*
		"files.remove":    false, // deny > allow
		"host.accounts":   true,  // tam ad
		"host.listDirs":   true,  // profil standard: host okumaları
		"power.reboot":    false, // profil standard, izin yok (yalnız full)
		"filesystem.read": false, // "files.*" öneki "filesystem"i kapsamaz
	}
	for op, want := range cases {
		if got := p.Allowed(op); got != want {
			t.Errorf("%s: %v ≠ %v", op, got, want)
		}
	}
	full, _ := Parse("profile full\ndeny power.*\n")
	if !full.Allowed("docker.api") || full.Allowed("power.reboot") {
		t.Fatal("full profil / deny")
	}
	// Çekirdek op deny ile kapatılamaz (merkez sunucuyu çevrimdışı sanırdı).
	locked, _ := Parse("deny *\n")
	if !locked.Allowed("agent.hello") || locked.Allowed("files.list") {
		t.Fatal("deny * çekirdeği kapatmamalı")
	}
}

func TestHataliSatir(t *testing.T) {
	for _, content := range []string{"profile hepsi", "allow", "izin files.*", "deny a b", "allow helper.x [bozuk"} {
		if _, err := Parse(content); err == nil {
			t.Errorf("%q kabul edildi", content)
		}
	}
}

func TestDosyaDegisinceYenidenOkunur(t *testing.T) {
	path := filepath.Join(t.TempDir(), "policy.conf")
	store := &Store{Path: path}
	if p, err := store.Current(); err != nil || p.Profile != "standard" || p.Allowed("power.reboot") {
		t.Fatalf("dosya yokken: %+v %v", p, err)
	}
	if err := os.WriteFile(path, []byte("allow power.*\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if p, _ := store.Current(); !p.Allowed("power.reboot") || p.Source != path {
		t.Fatalf("yazıldıktan sonra: %+v", p)
	}
	// Aynı boyutta içerik, farklı mtime.
	if err := os.WriteFile(path, []byte("deny  power.*\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(path, later, later)
	if p, _ := store.Current(); p.Allowed("power.reboot") {
		t.Fatal("değişiklik görülmedi")
	}
	// Bozuk dosya: hata + yalnız çekirdek.
	if err := os.WriteFile(path, []byte("profile ???\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(path, later.Add(time.Second), later.Add(time.Second))
	p, err := store.Current()
	if err == nil || p.Allowed("files.list") || !p.Allowed("agent.hello") {
		t.Fatalf("bozuk dosya: %+v %v", p, err)
	}
}

func TestHelperKararlari(t *testing.T) {
	std := Default()
	cases := []struct {
		action, subject string
		ok              bool
		reason          string
	}{
		{"service.list", "", true, ""},
		{"service.restart", "docker.service", true, ""},
		{"compose.up", "/opt/stacks/x", true, ""},
		{"shell.preset", "disk.usage", true, ""},
		{"shell.preset", "apt.update", true, ""},
		{"shell.preset", "apt.upgrade", false, "pattern"}, // geri alınamaz → full
		{"shell.exec", "rm -rf /", false, "action"},       // root kabuğu → full
		{"power.reboot", "", false, "action"},             // güç → full
	}
	for _, c := range cases {
		ok, reason := std.Helper(c.action, c.subject)
		if ok != c.ok || reason != c.reason {
			t.Errorf("standard %s(%q): %v/%q ≠ %v/%q", c.action, c.subject, ok, reason, c.ok, c.reason)
		}
	}
	readonly, _ := Parse("profile readonly")
	if ok, _ := readonly.Helper("service.restart", "x.service"); ok {
		t.Fatal("readonly servis yeniden başlatamaz")
	}
	if ok, _ := readonly.Helper("service.status", "x.service"); !ok {
		t.Fatal("readonly servis durumu okuyabilir")
	}
	full, _ := Parse("profile full")
	if ok, _ := full.Helper("power.reboot", ""); !ok {
		t.Fatal("full güç işi yapabilir")
	}

	// Açık allow satırı varsa yalnız o karar verir: desen gerçekten kısıtlar.
	narrowed, err := Parse(`
allow helper.service.restart ^docker\.service$
allow helper.shell.exec ^apt-get (update|upgrade -y)$
deny  helper.compose.down
`)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		action, subject string
		ok              bool
		reason          string
	}{
		{"service.restart", "docker.service", true, ""},
		{"service.restart", "ssh.service", false, "pattern"},
		{"service.stop", "ssh.service", true, ""}, // profil (standard)
		{"shell.exec", "apt-get update", true, ""},
		{"shell.exec", "apt-get update; rm -rf /", false, "pattern"},
		{"compose.down", "/opt/x", false, "action"},
		{"compose.up", "/opt/x", true, ""},
	} {
		ok, reason := narrowed.Helper(c.action, c.subject)
		if ok != c.ok || reason != c.reason {
			t.Errorf("daraltılmış %s(%q): %v/%q ≠ %v/%q", c.action, c.subject, ok, reason, c.ok, c.reason)
		}
	}
	got := narrowed.HelperActions([]string{"compose.down", "compose.up", "power.reboot", "service.restart", "shell.exec"})
	if strings.Join(got, ",") != "compose.up,service.restart,shell.exec" {
		t.Fatalf("açık eylemler: %v", got)
	}
}
