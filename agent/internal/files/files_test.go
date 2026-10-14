package files

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Sahte host kökü geçici dizinde: /srv (izinli), /etc (izinsiz), /var/log.

func fakeFs(t *testing.T) (Fs, string) {
	t.Helper()
	base := t.TempDir()
	write := func(rel, content string) {
		full := filepath.Join(base, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("srv/app/config.yml", "port: 80\n")
	write("srv/app/.env", "SECRET=1\n")
	write("srv/app/logo.png", "\x89PNG\x00\x00binary")
	write("srv/notlar.txt", "merhaba ğüş\n")
	write("etc/shadow", "root:$6$gizli\n")
	write("etc/passwd", "root:x:0:0:root:/root:/bin/bash\n+::::::\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nmucahid:x:1000:1000:Mucahid Erdogan,,,:/home/mucahid:/bin/bash\n")
	write("etc/group", "root:x:0:\nmucahid:x:1000:\n")
	write("var/log/syslog.1", "eski")
	write("var/log/syslog.2.gz", "eskigz")
	write("var/log/syslog", "yeni")
	write("var/log/journal/abc/system.journal", "jjjj")
	write("var/cache/apt/archives/a.deb", "deb!")
	fs := Fs{Base: base, T: func(key string, params map[string]any) string {
		if params != nil {
			if p, ok := params["path"]; ok {
				return key + ":" + p.(string)
			}
		}
		return key
	}}
	return fs, base
}

var roots = []string{"/srv"}

func TestYolDenetimi(t *testing.T) {
	fs, _ := fakeFs(t)
	for raw, want := range map[string]string{
		"/srv/app":               "",
		"/srv/app/../notlar.txt": "",
		"srv":                    "paths.absolute",
		"/srv/../etc/shadow":     "paths.outsideRoots",
		"/proc/1/environ":        "paths.forbidden",
		"/srv/a\x00b":            "paths.invalidChar",
	} {
		_, err := fs.Check(raw, roots)
		got := ""
		if err != nil {
			got = strings.SplitN(err.Error(), ":", 2)[0]
		}
		if got != want {
			t.Errorf("%q: %q ≠ %q", raw, got, want)
		}
	}
	if _, err := fs.Check("/srv", nil); err == nil || err.Error() != "paths.noRoots" {
		t.Fatalf("kök yokken: %v", err)
	}
	if got := Roots(map[string]any{"files.roots": " /srv/ , göreli, /, /opt//"}); strings.Join(got, ",") != "/srv,/,/opt" {
		t.Fatalf("kökler: %v", got)
	}
}

// Root çalışan ajanın asıl riski: izinli kökteki bağın kök DIŞINA çıkması.
func TestSembolikBagKacisi(t *testing.T) {
	fs, base := fakeFs(t)
	if err := os.Symlink(filepath.Join(base, "etc"), filepath.Join(base, "srv", "kacis")); err != nil {
		t.Skipf("sembolik bağ oluşturulamadı (Windows geliştirici modu?): %v", err)
	}
	if err := os.Symlink(filepath.Join(base, "etc", "shadow"), filepath.Join(base, "srv", "golge")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(base, "srv", "notlar.txt"), filepath.Join(base, "srv", "ic-bag")); err != nil {
		t.Fatal(err)
	}

	if _, err := fs.List("/srv/kacis", roots); err == nil {
		t.Fatal("kök dışına giden klasör bağı listelendi")
	}
	if _, err := fs.Read("/srv/golge", roots, 1024); err == nil {
		t.Fatal("kök dışına giden dosya bağı okundu")
	}
	if out := fs.Write("/srv/kacis/yeni", roots, []byte("x")); out.OK {
		t.Fatal("bağ üzerinden kök dışına yazıldı")
	}
	if _, err := os.Stat(filepath.Join(base, "etc", "yeni")); err == nil {
		t.Fatal("dosya kök dışında oluştu")
	}
	if out := fs.Chmod("/srv/golge", roots, "0777"); out.OK {
		t.Fatal("bağ üzerinden kök dışındaki dosyanın izni değişti")
	}
	if out := fs.Mkdir("/srv/kacis/altdizin", roots); out.OK {
		t.Fatal("bağ üzerinden kök dışında klasör açıldı")
	}
	// Kök içine giden bağ çalışır.
	if content, err := fs.Read("/srv/ic-bag", roots, 1024); err != nil || content.Content != "merhaba ğüş\n" {
		t.Fatalf("kök içi bağ: %+v %v", content, err)
	}
	// Bağın KENDİSİ silinebilir; hedef etkilenmez.
	if out := fs.Remove("/srv/golge", roots, false); !out.OK {
		t.Fatalf("bağ silinemedi: %+v", out)
	}
	if _, err := os.Stat(filepath.Join(base, "etc", "shadow")); err != nil {
		t.Fatal("bağ silinirken hedef silindi")
	}
	// Kökün kendisi bir bağsa (/data → /srv) çözülmüş hâli de kök sayılır.
	if err := os.Symlink(filepath.Join(base, "srv"), filepath.Join(base, "data")); err != nil {
		t.Fatal(err)
	}
	if _, err := fs.List("/data/app", []string{"/data"}); err != nil {
		t.Fatalf("bağlı kök: %v", err)
	}
}

func TestListeVeOkuma(t *testing.T) {
	fs, _ := fakeFs(t)
	listing, err := fs.List("/srv", roots)
	if err != nil {
		t.Fatal(err)
	}
	if listing.Path != "/srv" || *listing.Parent != "/" || listing.TotalEntries != 2 || listing.Entries[0].Kind != "dir" || listing.Entries[1].Name != "notlar.txt" {
		t.Fatalf("liste: %+v", listing)
	}
	if listing.Entries[1].Path != "/srv/notlar.txt" || len(listing.Entries[1].ModeOctal) != 4 || listing.Entries[1].SizeBytes != int64(len("merhaba ğüş\n")) {
		t.Fatalf("girdi: %+v", listing.Entries[1])
	}

	text, err := fs.Read("/srv/app/config.yml", roots, 1024)
	if err != nil || text.Content != "port: 80\n" || text.Binary || text.Truncated {
		t.Fatalf("okuma: %+v %v", text, err)
	}
	cut, _ := fs.Read("/srv/app/config.yml", roots, 4)
	if cut.Content != "port" || !cut.Truncated || cut.SizeBytes != 9 {
		t.Fatalf("kesme: %+v", cut)
	}
	if bin, _ := fs.Read("/srv/app/logo.png", roots, 1024); !bin.Binary || bin.Content != "" {
		t.Fatalf("ikili: %+v", bin)
	}
	if _, err := fs.Read("/srv/app/.env", roots, 1024); err == nil || err.Error() != "browse.secretContent" {
		t.Fatalf(".env okunmamalı: %v", err)
	}
	if _, err := fs.Read("/srv/app", roots, 1024); err == nil || err.Error() != "browse.notFile" {
		t.Fatalf("klasör okuma: %v", err)
	}

	var frames []any
	err = fs.Download(context.Background(), "/srv/notlar.txt", roots, func(frame any) error {
		frames = append(frames, frame)
		return nil
	}, func(b []byte) any { return string(b) })
	if err != nil || len(frames) != 2 || frames[0].(DownloadHead).Name != "notlar.txt" || frames[1] != "merhaba ğüş\n" {
		t.Fatalf("indirme: %v %v", frames, err)
	}

	usage, err := fs.Usage("/srv", roots, time.Second)
	if err != nil || usage.Entries[0].Name != "app" || usage.TotalBytes == 0 {
		t.Fatalf("kullanım: %+v %v", usage, err)
	}
}

func TestYazma(t *testing.T) {
	fs, base := fakeFs(t)
	check := func(out WriteOutcome, ok bool, label string) {
		t.Helper()
		if out.OK != ok {
			t.Fatalf("%s: %+v", label, out)
		}
	}
	check(fs.Mkdir("/srv/yeni/alt", roots), false, "üst klasör yokken") // Node: parentMissing
	check(fs.Mkdir("/srv/yeni", roots), true, "mkdir")
	check(fs.Write("/srv/yeni/a.txt", roots, []byte("bir")), true, "yaz")
	check(fs.Write("/srv/yeni/a.txt", roots, []byte("iki")), true, "üzerine yaz")
	if data, _ := os.ReadFile(filepath.Join(base, "srv", "yeni", "a.txt")); string(data) != "iki" {
		t.Fatalf("içerik %q", data)
	}
	check(fs.Rename("/srv/yeni/a.txt", roots, "../kacis.txt"), false, "yol içeren ad")
	check(fs.Rename("/srv/yeni/a.txt", roots, "b.txt"), true, "yeniden adlandır")
	check(fs.Chmod("/srv/yeni/b.txt", roots, "0640"), true, "chmod")
	check(fs.Chmod("/srv/yeni/b.txt", roots, "rwx"), false, "chmod sekizlik değil")
	check(fs.Remove("/srv/yeni", roots, false), false, "klasör -r olmadan")
	check(fs.Remove("/srv/yok-boyle", roots, false), true, "olmayan girdi (rm -f)")
	check(fs.Remove("/srv/yeni", roots, true), true, "özyinelemeli")
	check(fs.Remove("/", []string{"/"}, true), false, "kök")
	check(fs.Write("/etc/passwd", roots, []byte("x")), false, "izinsiz kök")
}

func TestHostOkumalari(t *testing.T) {
	fs, base := fakeFs(t)
	accounts := fs.Accounts()
	if accounts.Error != nil || len(accounts.Users) != 3 || accounts.Users[0].Name != "root" || accounts.Users[1].Name != "mucahid" || accounts.Users[1].Comment != "Mucahid Erdogan" || accounts.Users[2].Human {
		t.Fatalf("hesaplar: %+v", accounts)
	}
	if len(accounts.Groups) != 2 {
		t.Fatalf("gruplar: %+v", accounts.Groups)
	}

	dirs := fs.ListDirs("/")
	names := []string{}
	for _, d := range dirs.Dirs {
		names = append(names, d.Name)
	}
	if strings.Join(names, ",") != "etc,srv,var" || dirs.Parent != nil {
		t.Fatalf("klasörler: %v", names)
	}
	if fs.ListDirs("/proc").Error == nil || fs.ListDirs("/yok").Error == nil {
		t.Fatal("yasak/olmayan klasör hata vermeli")
	}
	if !fs.DirExists("/srv/app") || fs.DirExists("/srv/notlar.txt") || fs.DirExists("/dev") {
		t.Fatal("dirExists")
	}

	reports := filepath.Join(base, "reports")
	if report := OsReport(reports, 48, time.Unix(2_000_000, 0)); report.Available || report.Packages == nil {
		t.Fatalf("rapor yokken: %+v", report)
	}
	_ = os.MkdirAll(reports, 0o755)
	_ = os.WriteFile(filepath.Join(reports, "os-updates.json"), []byte(`{"reportedAt":1000000,"total":3,"security":1,"rebootRequired":true,"packages":[{"name":"curl","current":"8.1","candidate":"8.2","security":true}]}`), 0o644)
	report := OsReport(reports, 48, time.Unix(1_000_000+3600, 0))
	if !report.Available || report.Total != 3 || report.Stale || !report.RebootRequired || len(report.Packages) != 1 {
		t.Fatalf("rapor: %+v", report)
	}
	if OsReport(reports, 1, time.Unix(1_000_000+7200, 0)).Stale != true {
		t.Fatal("eski rapor")
	}

	scan := fs.ScanWatchDir("/var/log")
	if scan.Error != nil || scan.FileCount != 3 || scan.NewestName == nil {
		t.Fatalf("yedek klasörü: %+v", scan)
	}
	if missing := fs.ScanWatchDir("/yok"); missing.Error == nil || !strings.HasPrefix(*missing.Error, "backupWatch.notFound") {
		t.Fatalf("olmayan: %+v", missing)
	}
}

func TestTemizlik(t *testing.T) {
	fs, base := fakeFs(t)
	scan := fs.CleanupScan()
	ids := []string{}
	for _, item := range scan.Items {
		ids = append(ids, item.ID)
	}
	if strings.Join(ids, ",") != "rotated-logs,apt-cache,journald" && strings.Join(ids, ",") != "rotated-logs,journald,apt-cache" {
		t.Fatalf("kalemler: %v", ids)
	}
	if res := fs.CleanupRun("journald", []string{"/var"}); res.OK {
		t.Fatal("journald elle temizlenmeli")
	}
	if res := fs.CleanupRun("yok", []string{"/var"}); res.OK || res.Message != "cleanup.notInList" {
		t.Fatalf("bilinmeyen: %+v", res)
	}
	// Kökler /var'ı kapsamıyorsa silme reddedilir (Node ile aynı).
	if res := fs.CleanupRun("rotated-logs", roots); res.OK {
		t.Fatal("izinli kök dışında silindi")
	}
	res := fs.CleanupRun("rotated-logs", []string{"/var"})
	if !res.OK || res.ReclaimedBytes != int64(len("eski")+len("eskigz")) {
		t.Fatalf("döndürülmüş loglar: %+v", res)
	}
	if _, err := os.Stat(filepath.Join(base, "var", "log", "syslog")); err != nil {
		t.Fatal("güncel log silindi")
	}
}

// Güvenlik incelemesi (2026-10-14): kökler ne olursa olsun ajanın kendi
// dosyaları (politika, anahtar, env) okunamaz/yazılamaz.
func TestAjanDosyalariKorunur(t *testing.T) {
	fs, base := fakeFs(t)
	write := func(rel string) {
		full := filepath.Join(base, filepath.FromSlash(rel))
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		_ = os.WriteFile(full, []byte("x"), 0o600)
	}
	write("etc/panel-agent/policy.conf")
	write("var/lib/panel-agent/key.pem")
	fs.Protected = []string{"/etc/panel-agent", "/var/lib/panel-agent"}
	all := []string{"/"}
	if _, err := fs.Read("/etc/panel-agent/policy.conf", all, 1024); err == nil {
		t.Fatal("politika okundu")
	}
	if out := fs.Write("/etc/panel-agent/policy.conf", all, []byte("profile full")); out.OK {
		t.Fatal("politika yazıldı")
	}
	if _, err := fs.Read("/var/lib/panel-agent/key.pem", all, 1024); err == nil {
		t.Fatal("TLS anahtarı okundu")
	}
	if out := fs.Remove("/etc/panel-agent", all, true); out.OK {
		t.Fatal("politika klasörü silindi")
	}
	if _, err := fs.List("/etc/panel-agent", all); err == nil {
		t.Fatal("politika klasörü listelendi")
	}
	// Başka bir adla "panel-agent" klasörü yaratılamaz.
	if out := fs.Mkdir("/etc/yeni", all); !out.OK {
		t.Fatal(out)
	}
	if out := fs.Rename("/etc/yeni", all, "panel-agent-x"); !out.OK {
		t.Fatalf("ilgisiz ad engellendi: %+v", out)
	}
	if out := fs.Rename("/etc/panel-agent-x", all, "panel-agent"); out.OK {
		t.Fatal("korunan ada yeniden adlandırıldı")
	}
	// ATA üzerinden: /etc'i adlandırıp ya da silip korunanı taşımak (güvenlik incelemesi).
	if out := fs.Rename("/etc", all, "etc-eski"); out.OK {
		t.Fatal("korunan klasörün atası yeniden adlandırıldı")
	}
	if out := fs.Remove("/etc", all, true); out.OK {
		t.Fatal("korunan klasörün atası silindi")
	}
	if out := fs.Remove("/var/lib", all, true); out.OK {
		t.Fatal("veri klasörünün atası silindi")
	}
	// İlgisiz kardeş klasör etkilenmez.
	if out := fs.Rename("/etc/yeni-x", all, "baska"); out.OK == false && !strings.Contains(out.Message, "parentMissing") {
		t.Logf("kardeş (olmayan) — beklenen hata: %s", out.Message)
	}
	// /etc'nin geri kalanı kök "/" ile okunabilir.
	if _, err := fs.List("/etc", all); err != nil {
		t.Fatal(err)
	}
}
