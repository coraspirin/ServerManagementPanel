package files

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Yazma tarafı. Node ajan her işlemi hedef klasörü bağlayan geçici bir
// container'da yapar; native ajan root olduğu için doğrudan — kurallar aynı:
// hedef ve üst klasör izinli, kök silinemez, yeni ad bir AD (yol değil),
// özyinelemeli silme yalnız açıkça istenince.

// WriteOutcome — merkezdeki WriteOutcome.
type WriteOutcome struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

func (f Fs) outcome(err error) WriteOutcome {
	if err != nil {
		return WriteOutcome{OK: false, Message: err.Error()}
	}
	return WriteOutcome{OK: true, Message: f.T("docker.installer.ok", nil)}
}

// parentDir — üst klasör gerçekten var mı (Node: Docker bind kaynağı yoksa
// sessizce oluşturuyordu; burada da açık hata).
func (f Fs) parentDir(realParent, hostPath string) error {
	info, err := os.Stat(realParent)
	if err != nil || !info.IsDir() {
		return f.fail("fileWrite.parentMissing", map[string]any{"path": filepathDirHost(hostPath)})
	}
	return nil
}

func filepathDirHost(hostPath string) string {
	if i := strings.LastIndex(hostPath, "/"); i > 0 {
		return hostPath[:i]
	}
	return "/"
}

// guardAncestor — silme/yeniden adlandırma korunan bir yolu (ya da atasını)
// hem istenen hem çözülmüş yoluyla taşıyamaz/silemez.
func (f Fs) guardAncestor(hostPath, realParent, name string) error {
	resolved := f.toHost(filepath.Join(realParent, name))
	for _, candidate := range []string{hostPath, resolved} {
		if f.containsProtected(candidate) {
			return f.fail("paths.forbidden", map[string]any{"path": candidate})
		}
	}
	return nil
}

// Mkdir — files.mkdir (`mkdir -p`).
func (f Fs) Mkdir(raw string, roots []string) WriteOutcome {
	hostPath, realParent, name, err := f.Parent(raw, roots)
	if err != nil {
		return f.outcome(err)
	}
	if err := f.parentDir(realParent, hostPath); err != nil {
		return f.outcome(err)
	}
	return f.outcome(os.MkdirAll(filepath.Join(realParent, name), 0o755))
}

// Remove — files.remove. `recursive` yoksa klasör silinmez (`rm -f`);
// olmayan girdi hata değil.
func (f Fs) Remove(raw string, roots []string, recursive bool) WriteOutcome {
	hostPath, realParent, name, err := f.Parent(raw, roots)
	if err != nil {
		return f.outcome(err)
	}
	if err := f.guardAncestor(hostPath, realParent, name); err != nil {
		return f.outcome(err)
	}
	if err := f.parentDir(realParent, hostPath); err != nil {
		return f.outcome(err)
	}
	target := filepath.Join(realParent, name)
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return f.outcome(nil)
	}
	if err != nil {
		return f.outcome(err)
	}
	if info.IsDir() {
		if !recursive {
			return f.outcome(f.fail("fileWrite.isDirectory", map[string]any{"path": hostPath}))
		}
		return f.outcome(os.RemoveAll(target))
	}
	return f.outcome(os.Remove(target))
}

// Rename — files.rename (aynı klasörde yeni ad).
func (f Fs) Rename(raw string, roots []string, newName string) WriteOutcome {
	hostPath, realParent, name, err := f.Parent(raw, roots)
	if err != nil {
		return f.outcome(err)
	}
	if err := f.guardAncestor(hostPath, realParent, name); err != nil {
		return f.outcome(err)
	}
	clean := strings.TrimSpace(newName)
	if clean == "" {
		return f.outcome(f.fail("fileWrite.nameEmpty", nil))
	}
	if strings.Contains(clean, "/") || clean == "." || clean == ".." || strings.Contains(clean, "\x00") {
		return f.outcome(f.fail("fileWrite.nameSlash", nil))
	}
	if err := f.parentDir(realParent, hostPath); err != nil {
		return f.outcome(err)
	}
	// Hedef ad korunan bir yola düşmesin (ör. /etc altında "panel-agent").
	if f.protected(f.toHost(filepath.Join(realParent, clean))) {
		return f.outcome(f.fail("paths.forbidden", map[string]any{"path": f.toHost(filepath.Join(realParent, clean))}))
	}
	return f.outcome(os.Rename(filepath.Join(realParent, name), filepath.Join(realParent, clean)))
}

var octalRe = regexp.MustCompile(`^[0-7]{3,4}$`)

// Chmod — files.chmod (bağı izler: çözülmüş hedef izinli kökte olmalı).
func (f Fs) Chmod(raw string, roots []string, mode string) WriteOutcome {
	clean := strings.TrimSpace(mode)
	if !octalRe.MatchString(clean) {
		return f.outcome(f.fail("fileWrite.modeOctal", nil))
	}
	hostPath, real, err := f.Follow(raw, roots)
	if err != nil {
		return f.outcome(err)
	}
	if hostPath == "/" {
		return f.outcome(f.fail("fileWrite.rootForbidden", nil))
	}
	bits, _ := strconv.ParseUint(clean, 8, 32)
	return f.outcome(os.Chmod(real, fileMode(uint32(bits))))
}

// fileMode — Unix izin sayısını (setuid/setgid/sticky dahil) Go'nun FileMode'una.
func fileMode(bits uint32) os.FileMode {
	mode := os.FileMode(bits & 0o777)
	if bits&0o4000 != 0 {
		mode |= os.ModeSetuid
	}
	if bits&0o2000 != 0 {
		mode |= os.ModeSetgid
	}
	if bits&0o1000 != 0 {
		mode |= os.ModeSticky
	}
	return mode
}

// Write — files.write (düzenleme + yükleme). Var olan dosyanın izin ve
// sahipliği korunur (`cp` ile aynı: içerik yerinde değişir); yeni dosya 0644.
func (f Fs) Write(raw string, roots []string, content []byte) WriteOutcome {
	// Parent: kök "/" yazılamaz ve üst klasör izinli olmalı; Follow: hedef
	// bir bağsa çözülmüş hâli de izinli kökte olmalı.
	hostPath, _, _, err := f.Parent(raw, roots)
	if err != nil {
		return f.outcome(err)
	}
	_, real, err := f.Follow(raw, roots)
	if err != nil {
		return f.outcome(err)
	}
	if err := f.parentDir(filepath.Dir(real), hostPath); err != nil {
		return f.outcome(err)
	}
	if info, err := os.Stat(real); err == nil && info.IsDir() {
		return f.outcome(f.fail("browse.notFile", nil))
	}
	file, err := os.OpenFile(real, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return f.outcome(err)
	}
	if _, err := file.Write(content); err != nil {
		file.Close()
		return f.outcome(err)
	}
	return f.outcome(file.Close())
}

// RemoveFilesIn — bir klasördeki birçok dosyayı siler (temizlik asistanı);
// `names` yalnız AD olmalı.
func (f Fs) RemoveFilesIn(parentHost string, roots []string, names []string) WriteOutcome {
	if len(names) == 0 {
		return WriteOutcome{OK: true, Message: f.T("fileWrite.nothingToDelete", nil)}
	}
	for _, name := range names {
		if strings.Contains(name, "/") || name == "." || name == ".." || name == "" {
			return f.outcome(f.fail("fileWrite.invalidName", nil))
		}
	}
	_, real, err := f.Follow(parentHost, roots)
	if err != nil {
		return f.outcome(err)
	}
	for _, name := range names {
		target := filepath.Join(real, name)
		info, err := os.Lstat(target)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return f.outcome(err)
		}
		if info.IsDir() {
			continue
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			return f.outcome(err)
		}
	}
	return f.outcome(nil)
}
