package policy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sample = `# Bu sunucunun ajana izin verdikleri
profile standard
allow helper.service.restart ^docker\.service$
deny power.*
`

func TestProfilDegisirYorumlarKalir(t *testing.T) {
	out, err := SetProfile(sample, "readonly")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out, "# Bu sunucunun") || !strings.Contains(out, "\nprofile readonly\n") || strings.Contains(out, "standard") {
		t.Fatalf("beklenmedik:\n%s", out)
	}
	// profile satırı yoksa ilk yönergeden önce eklenir.
	out, _ = SetProfile("# yorum\nallow files.*\n", "full")
	if out != "# yorum\nprofile full\nallow files.*\n" {
		t.Fatalf("ekleme yeri:\n%q", out)
	}
	if _, err := SetProfile(sample, "root"); err == nil {
		t.Fatal("bilinmeyen profil kabul edildi")
	}
}

func TestAllowDenyBirbiriniKaldirir(t *testing.T) {
	out, err := Allow(sample, "power.*", "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "deny power.*") || !strings.HasSuffix(out, "allow power.*\n") {
		t.Fatalf("allow:\n%s", out)
	}
	out, err = Deny(out, "power.*")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "allow power.*") || strings.Count(out, "deny power.*") != 1 {
		t.Fatalf("deny:\n%s", out)
	}
	p, _ := Parse(out)
	if p.Allowed("power.reboot") {
		t.Fatal("deny etkisiz")
	}
}

func TestDuzenlemeDogrulanir(t *testing.T) {
	if _, err := Allow(sample, "helper.service.restart", "([a-z"); err == nil {
		t.Fatal("bozuk desen kabul edildi")
	}
	if _, err := Allow(sample, "files list", ""); err == nil {
		t.Fatal("boşluklu ad kabul edildi")
	}
	if _, err := Allow(sample, "helper.x", "a # b"); err == nil {
		t.Fatal("# içeren desen kabul edildi (yorum sanılırdı)")
	}
	if _, err := Allow(sample, "files.read", "^/var/log"); err == nil {
		t.Fatal("helper dışı op'a desen kabul edildi (op'u tamamen açardı)")
	}
	if _, err := Parse("allow docker.api ^GET$"); err == nil {
		t.Fatal("Parse helper dışı desenli satırı kabul etti")
	}
	if _, err := Deny(sample, "agent.update"); err == nil {
		t.Fatal("çekirdek op kapatıldı")
	}
	out, err := Allow(sample, "helper.service.restart", `^(nginx|caddy)\.service$`)
	if err != nil {
		t.Fatal(err)
	}
	p, _ := Parse(out)
	if ok, _ := p.Helper("service.restart", "caddy.service"); !ok {
		t.Fatal("desenli allow etkisiz")
	}
}

func TestAtomikYazim(t *testing.T) {
	path := filepath.Join(t.TempDir(), "etc", "policy.conf")
	if err := WriteFile(path, sample); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != sample {
		t.Fatal("içerik farklı")
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("geçici dosya kaldı: %v", entries)
	}
}

func TestReadonlyYalnizOkur(t *testing.T) {
	p, _ := Parse("profile readonly")
	for _, op := range []string{"files.list", "files.read", "files.download", "host.accounts", "docker.api", "docker.apiStream", "updates.osReport"} {
		if !p.Allowed(op) {
			t.Errorf("readonly %s'i okuyamıyor", op)
		}
	}
	for _, op := range []string{"files.write", "files.remove", "files.rename", "files.chmod", "files.mkdir", "files.cleanupRun", "exec.start", DockerWrite} {
		if p.Allowed(op) {
			t.Errorf("readonly %s'e izin veriyor", op)
		}
	}
	std, _ := Parse("profile standard")
	if !std.Allowed(DockerWrite) {
		t.Fatal("standard Docker'a yazamıyor")
	}
	ro, _ := Parse("profile standard\ndeny docker.write")
	if ro.Allowed(DockerWrite) || !ro.Allowed("docker.api") {
		t.Fatal("deny docker.write → salt okunur Docker olmalı")
	}
	if got := std.Reason("agent.hello") + "," + ro.Reason(DockerWrite) + "," + std.Reason("files.list") + "," + std.Reason("power.reboot"); got != "core,deny,profile," {
		t.Fatalf("Reason: %s", got)
	}
}
