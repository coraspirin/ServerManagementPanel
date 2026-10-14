package policy

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Dosya düzenleme — `panel-agent policy profile|allow|deny` (Faz B adım 6).
// Yorumlar ve diğer satırlar korunur; sonuç Parse'tan geçmeden yazılmaz.

// directive — satırın (yorum çıkarılmış) ilk iki alanı.
func directive(line string) (verb, name string) {
	if i := strings.Index(line, "#"); i >= 0 {
		line = line[:i]
	}
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return "", ""
	}
	if len(fields) == 1 {
		return fields[0], ""
	}
	return fields[0], fields[1]
}

func splitLines(content string) []string {
	content = strings.TrimRight(content, "\n")
	if content == "" {
		return nil
	}
	return strings.Split(content, "\n")
}

func joinLines(lines []string) string { return strings.Join(lines, "\n") + "\n" }

// validName — op adı ya da "önek.*" / "*".
var validName = regexp.MustCompile(`^(\*|[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)*(\.\*)?)$`)

// SetProfile — `profile` satırını değiştirir (yoksa ilk yönergeden önce ekler).
func SetProfile(content, profile string) (string, error) {
	if _, ok := profileAllows[profile]; !ok {
		return "", fmt.Errorf("bilinmeyen profil %q (%s)", profile, strings.Join(Profiles(), " | "))
	}
	lines := splitLines(content)
	replaced := false
	out := lines[:0:0]
	for _, line := range lines {
		if verb, _ := directive(line); verb == "profile" {
			if !replaced {
				out = append(out, "profile "+profile)
				replaced = true
			}
			continue
		}
		out = append(out, line)
	}
	if !replaced {
		at := len(out)
		for i, line := range out {
			if verb, _ := directive(line); verb != "" {
				at = i
				break
			}
		}
		out = append(out[:at], append([]string{"profile " + profile}, out[at:]...)...)
	}
	return checked(joinLines(out))
}

// Allow — `allow <ad> [desen]` ekler; aynı ad için `deny` satırlarını kaldırır.
func Allow(content, name, pattern string) (string, error) {
	if !validName.MatchString(name) {
		return "", fmt.Errorf("geçersiz ad %q (ör. files.*, helper.service.restart)", name)
	}
	if pattern != "" {
		if strings.Contains(pattern, "#") || strings.ContainsAny(pattern, "\n\r") {
			return "", fmt.Errorf("desen # ya da satır sonu içeremez")
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return "", fmt.Errorf("desen derlenemedi: %v", err)
		}
	}
	var out []string
	for _, line := range splitLines(content) {
		if verb, target := directive(line); verb == "deny" && target == name {
			continue
		}
		out = append(out, line)
	}
	line := "allow " + name
	if pattern != "" {
		line += " " + pattern
	}
	return checked(joinLines(append(out, line)))
}

// Deny — `deny <ad>` ekler; aynı ad için `allow` satırlarını kaldırır.
func Deny(content, name string) (string, error) {
	if !validName.MatchString(name) {
		return "", fmt.Errorf("geçersiz ad %q", name)
	}
	if Core[name] {
		return "", fmt.Errorf("%s çekirdek işlem, kapatılamaz", name)
	}
	var out []string
	exists := false
	for _, line := range splitLines(content) {
		verb, target := directive(line)
		if verb == "allow" && target == name {
			continue
		}
		if verb == "deny" && target == name {
			exists = true
		}
		out = append(out, line)
	}
	if !exists {
		out = append(out, "deny "+name)
	}
	return checked(joinLines(out))
}

func checked(content string) (string, error) {
	if _, err := Parse(content); err != nil {
		return "", err
	}
	return content, nil
}

// WriteFile — atomik yazım (aynı klasörde geçici dosya + rename), 0644.
func WriteFile(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".policy-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
