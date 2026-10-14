// Package files — dosya yöneticisi ve host'a bakan okuma işleri
// (`files.*`, `host.*`, `backup.scanDir`, `updates.osReport`). Merkezdeki
// src/lib/files/*, host/{dirs,users}.ts, updates/os.ts, backup/watch.ts ile
// aynı sözleşme (dönüş biçimleri, sınırlar, ayarlar).
//
// Node ajanından FARKI: Node ajan host kökünü salt-okunur bağdan okur ve
// yazmayı geçici container'a yaptırır; native ajan host'ta root çalıştığı
// için ikisini de doğrudan yapar. Bu yüzden yol güvenliği burada daha sıkı:
// sembolik bağlar ÇÖZÜLÜR ve çözülmüş gerçek yol da izinli köklerin içinde
// olmalı (aksi hâlde izinli bir kökteki `bag → /etc/shadow` kök dışına
// çıkardı — root bir süreçte bu doğrudan okuma/yazma olurdu).
package files

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// Hiçbir koşulda erişilmeyen yollar (çekirdek arayüzü, cihazlar).
var never = []string{"/proc", "/sys", "/dev", "/run"}

// ForbiddenPath — `never` altına düşüyor mu.
func ForbiddenPath(hostPath string) bool {
	for _, entry := range never {
		if hostPath == entry || strings.HasPrefix(hostPath, entry+"/") {
			return true
		}
	}
	return false
}

// İçeriği hiçbir zaman okunmayan dosyalar (listede görünebilirler).
var sensitive = []*regexp.Regexp{
	regexp.MustCompile(`^/etc/shadow-?$`),
	regexp.MustCompile(`^/etc/gshadow-?$`),
	regexp.MustCompile(`^/etc/sudoers(\.d/.*)?$`),
	regexp.MustCompile(`^/etc/ssh/ssh_host_.*_key$`),
	regexp.MustCompile(`(^|/)id_(rsa|dsa|ecdsa|ed25519)$`),
	regexp.MustCompile(`(^|/)\.env(\..+)?$`),
	regexp.MustCompile(`(^|/)\.ssh/.*_key$`),
	regexp.MustCompile(`(^|/)\.git-credentials$`),
}

// ContentReadable — içerik okunabilir mi.
func ContentReadable(hostPath string) bool {
	for _, pattern := range sensitive {
		if pattern.MatchString(hostPath) {
			return false
		}
	}
	return true
}

// Fs — host dosya sistemi görünümü. Base üretimde "/"; testlerde geçici dizin.
type Fs struct {
	Base string
	T    func(key string, params map[string]any) string
	// Protected — ajanın KENDİ dosyaları (politika, sertifika/anahtar, sır
	// içeren env, ikili): `files.roots` ne olursa olsun okunmaz/yazılmaz.
	// Aksi hâlde kökleri "/" yapan bir merkez ajanın politikasını yeniden
	// yazıp kendine `full` verebilir ya da TLS anahtarını okuyabilirdi
	// (güvenlik incelemesi 2026-10-14). Host yolları, mutlak.
	Protected []string
}

func (f Fs) protected(hostPath string) bool {
	for _, dir := range f.Protected {
		dir = Normalize(dir)
		if hostPath == dir || strings.HasPrefix(hostPath, strings.TrimSuffix(dir, "/")+"/") {
			return true
		}
	}
	return false
}

// containsProtected — yol korunan bir klasörün KENDİSİ, içi ya da ATASI mı.
// Silme ve yeniden adlandırma ata üzerinden de korunanı taşır/siler (`/etc`'i
// adlandırıp yerine yeni bir `/etc/panel-agent` yazmak) — güvenlik
// incelemesi 2026-10-14.
func (f Fs) containsProtected(hostPath string) bool {
	if f.protected(hostPath) {
		return true
	}
	for _, dir := range f.Protected {
		dir = Normalize(dir)
		if hostPath == "/" || strings.HasPrefix(dir, strings.TrimSuffix(hostPath, "/")+"/") {
			return true
		}
	}
	return false
}

// Real — host yolunun işletim sistemindeki karşılığı.
func (f Fs) Real(hostPath string) string {
	if f.Base == "" || f.Base == "/" {
		return filepath.FromSlash(hostPath)
	}
	return filepath.Join(f.Base, filepath.FromSlash(hostPath))
}

// toHost — işletim sistemi yolunu host yoluna geri çevirir.
func (f Fs) toHost(real string) string {
	slashed := filepath.ToSlash(real)
	if f.Base == "" || f.Base == "/" {
		return slashed
	}
	base := filepath.ToSlash(filepath.Clean(f.Base))
	if trimmed := strings.TrimPrefix(slashed, base); trimmed != slashed {
		if trimmed == "" {
			return "/"
		}
		return trimmed
	}
	return slashed
}

// Roots — `files.roots` ayarı (virgüllü, mutlak); boşsa dosya yöneticisi kapalı.
func Roots(settings map[string]any) []string {
	raw, _ := settings["files.roots"].(string)
	var out []string
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if !strings.HasPrefix(entry, "/") {
			continue
		}
		if len(entry) > 1 {
			entry = strings.TrimRight(entry, "/")
			if entry == "" {
				entry = "/"
			}
		}
		out = append(out, entry)
	}
	return out
}

// Normalize — `path.posix.normalize` + sondaki eğik çizgiler.
func Normalize(input string) string {
	cleaned := path.Clean(input)
	if cleaned != "/" {
		cleaned = strings.TrimRight(cleaned, "/")
	}
	if cleaned == "" {
		return "/"
	}
	return cleaned
}

func inside(hostPath, root string) bool {
	return hostPath == root || strings.HasPrefix(hostPath, strings.TrimSuffix(root, "/")+"/") || root == "/"
}

// ErrPath — kullanıcıya gösterilecek doğrulama hatası.
type ErrPath struct{ Message string }

func (e *ErrPath) Error() string { return e.Message }

func (f Fs) fail(key string, params map[string]any) error {
	return &ErrPath{Message: f.T(key, params)}
}

// Check — kullanıcıdan gelen yolu doğrular (Node `checkPath`): mutlak, NUL
// yok, `..` çözülmüş, yasak değil, izinli kökün içinde. Sembolik bağ
// denetimi ayrı (`Follow` / `Parent`).
func (f Fs) Check(raw string, roots []string) (string, error) {
	input := strings.TrimSpace(raw)
	if input == "" {
		input = "/"
	}
	if !strings.HasPrefix(input, "/") {
		return "", f.fail("paths.absolute", nil)
	}
	if strings.Contains(input, "\x00") {
		return "", f.fail("paths.invalidChar", nil)
	}
	hostPath := Normalize(input)
	for _, forbidden := range never {
		if hostPath == forbidden || strings.HasPrefix(hostPath, forbidden+"/") {
			return "", f.fail("paths.forbidden", map[string]any{"path": forbidden})
		}
	}
	if f.protected(hostPath) {
		return "", f.fail("paths.forbidden", map[string]any{"path": hostPath})
	}
	if len(roots) == 0 {
		return "", f.fail("paths.noRoots", nil)
	}
	for _, root := range roots {
		if inside(hostPath, root) {
			return hostPath, nil
		}
	}
	return "", f.fail("paths.outsideRoots", map[string]any{"roots": strings.Join(roots, ", ")})
}

// evalExisting — var olan en derin ataya kadar sembolik bağları çözer, kalan
// (henüz olmayan) parçaları ekler. Sonuç host yolu.
func (f Fs) evalExisting(hostPath string) (string, error) {
	current := hostPath
	var rest []string
	for {
		real, err := filepath.EvalSymlinks(f.Real(current))
		if err == nil {
			resolved := f.toHost(real)
			for i := len(rest) - 1; i >= 0; i-- {
				resolved = path.Join(resolved, rest[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		if current == "/" {
			return hostPath, nil
		}
		rest = append(rest, path.Base(current))
		current = path.Dir(current)
	}
}

// realRoots — köklerin kendileri sembolik bağ olabilir (/data → /mnt/disk):
// çözülmüş hâlleri de kök sayılır.
func (f Fs) realRoots(roots []string) []string {
	out := append([]string(nil), roots...)
	for _, root := range roots {
		if resolved, err := f.evalExisting(root); err == nil && resolved != root {
			out = append(out, resolved)
		}
	}
	return out
}

func (f Fs) withinResolved(resolved string, roots []string) error {
	if ForbiddenPath(resolved) || f.protected(resolved) {
		return f.fail("paths.forbidden", map[string]any{"path": resolved})
	}
	for _, root := range f.realRoots(roots) {
		if inside(resolved, root) {
			return nil
		}
	}
	return f.fail("paths.outsideRoots", map[string]any{"roots": strings.Join(roots, ", ")})
}

// Follow — hedefin kendisine (bağı izleyerek) erişecek işlemler için:
// okuma, indirme, listeleme, boyut, chmod, yazma. Döner: host yolu (gösterim
// için) + gerçek yol (erişim için).
func (f Fs) Follow(raw string, roots []string) (hostPath, real string, err error) {
	hostPath, err = f.Check(raw, roots)
	if err != nil {
		return "", "", err
	}
	resolved, err := f.evalExisting(hostPath)
	if err != nil {
		return "", "", err
	}
	if err := f.withinResolved(resolved, roots); err != nil {
		return "", "", err
	}
	return hostPath, f.Real(resolved), nil
}

// Parent — girdinin KENDİSİNE yapılan işlemler (silme, yeniden adlandırma):
// üst klasörün gerçek yolu denetlenir, girdi bağsa bağın kendisi işlenir.
// Döner: host yolu, gerçek üst klasör, ad.
func (f Fs) Parent(raw string, roots []string) (hostPath, realParent, name string, err error) {
	hostPath, err = f.Check(raw, roots)
	if err != nil {
		return "", "", "", err
	}
	if hostPath == "/" {
		return "", "", "", f.fail("fileWrite.rootForbidden", nil)
	}
	parent := path.Dir(hostPath)
	if _, err := f.Check(parent, roots); err != nil {
		return "", "", "", err
	}
	resolved, err := f.evalExisting(parent)
	if err != nil {
		return "", "", "", err
	}
	if err := f.withinResolved(resolved, roots); err != nil {
		return "", "", "", err
	}
	return hostPath, f.Real(resolved), path.Base(hostPath), nil
}
