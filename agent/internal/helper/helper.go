// Package helper — host-helper eylemlerinin native ajandaki karşılığı
// (kararlar.md K4: ajanlı sunucuda ayrı helper daemon'u gerekmez).
//
// Eylem tablosu, argüman doğrulayıcıları, zaman aşımları ve HATA METİNLERİ
// host-helper/panel-helper.py ile BİREBİR: merkez helper hatalarını sabit
// Türkçe parçalarla ipucuna çeviriyor (src/lib/permissions/hint.ts
// `helperErrorCode`: "izinli değil", "desene uymuyor", "bilinmeyen eylem").
//
// Farkı: izin listesi `/etc/panel-helper/allow.conf` değil ajanın
// `/etc/panel-agent/policy.conf`'u (`allow helper.<eylem> [desen]`) ve
// profil varsayılanları (policy paketi). Komutlar kabuksuz çalışır
// (shell.exec hariç — o eylemin kendisi kabuk).
package helper

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// CommandTimeout — tek komutun üst sınırı.
	CommandTimeout = 120 * time.Second
	// ConsoleTimeout — konsol eylemleri (`apt-get upgrade` yarım kalmasın).
	ConsoleTimeout = 900 * time.Second
	// CommandMaxLength — serbest komut metni.
	CommandMaxLength = 2000
)

// RemotePrefixes — merkez uzak sunucuda yalnız bunları ister
// (src/lib/host/helper.ts REMOTE_HELPER_PREFIXES); Node ajanla aynı süzgeç.
var RemotePrefixes = []string{"power.", "service.", "compose.", "journal.", "shell."}

func RemoteAllowed(action string) bool {
	for _, prefix := range RemotePrefixes {
		if strings.HasPrefix(action, prefix) {
			return true
		}
	}
	return false
}

// Args — merkezden gelen eylem argümanları.
type Args map[string]any

func (a Args) str(key, fallback string) string {
	value, ok := a[key]
	if !ok || value == nil {
		return fallback
	}
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "True"
		}
		return "False"
	default:
		return fmt.Sprint(v)
	}
}

// intArg — Python int() gibi: sayı ya da tamsayı metni.
func (a Args) intArg(key string, fallback int) (int, error) {
	value, ok := a[key]
	if !ok || value == nil {
		return fallback, nil
	}
	switch v := value.(type) {
	case float64:
		return int(v), nil
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0, fmt.Errorf("invalid literal for int() with base 10: '%s'", v)
		}
		return n, nil
	}
	return 0, errors.New("int() argümanı geçersiz")
}

var (
	unitRe    = regexp.MustCompile(`^[A-Za-z0-9._@:-]{1,128}$`)
	cronRe    = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)
	jailRe    = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
	ipRe      = regexp.MustCompile(`^[0-9a-fA-F:.]{3,45}$`)
	errInput  = errors.New
	aptOpts   = []string{"-y", "-o", "Dpkg::Options::=--force-confold"}
	consoleEn = []string{"DEBIAN_FRONTEND=noninteractive"}
)

func delay(a Args) (string, error) {
	seconds, err := a.intArg("delaySeconds", 0)
	if err != nil {
		return "", err
	}
	if seconds < 0 || seconds > 86400 {
		return "", errInput("delaySeconds 0-86400 arasında olmalı")
	}
	return strconv.Itoa(seconds / 60), nil
}

func unit(a Args) (string, error) {
	value := a.str("unit", "")
	if !unitRe.MatchString(value) {
		return "", errInput("geçersiz birim adı")
	}
	return value, nil
}

func journalSince(a Args) (string, error) {
	seconds, err := a.intArg("sinceSeconds", 3600)
	if err != nil {
		return "", err
	}
	if seconds < 1 || seconds > 86400 {
		return "", errInput("sinceSeconds 1-86400 arasında olmalı")
	}
	return fmt.Sprintf("-%ds", seconds), nil
}

func journalLines(a Args) (string, error) {
	lines, err := a.intArg("lines", 2000)
	if err != nil {
		return "", err
	}
	if lines < 1 || lines > 50000 {
		return "", errInput("lines 1-50000 arasında olmalı")
	}
	return strconv.Itoa(lines), nil
}

func cronUser(a Args) (string, error) {
	value := a.str("user", "root")
	if !cronRe.MatchString(value) {
		return "", errInput("gecersiz kullanici adi")
	}
	return value, nil
}

func jail(a Args) (string, error) {
	value := a.str("jail", "")
	if !jailRe.MatchString(value) {
		return "", errInput("gecersiz jail adi")
	}
	return value, nil
}

func ip(a Args) (string, error) {
	value := a.str("ip", "")
	if !ipRe.MatchString(value) {
		return "", errInput("gecersiz IP")
	}
	return value, nil
}

func projectDir(a Args) (string, error) {
	value := a.str("dir", "")
	if !strings.HasPrefix(value, "/") {
		return "", errInput("geçersiz dizin")
	}
	for _, part := range strings.Split(value, "/") {
		if part == ".." {
			return "", errInput("geçersiz dizin")
		}
	}
	return value, nil
}

// Presets — konsolun hazır kalıpları (panel yalnız ANAHTAR gönderir).
// Panel tarafındaki karşılığı src/lib/host/presets.ts.
var Presets = map[string][]string{
	"apt.update":        {"/usr/bin/apt-get", "update"},
	"apt.list_upgrades": {"/usr/bin/apt", "list", "--upgradable"},
	"apt.upgrade":       append(append([]string{"/usr/bin/apt-get"}, aptOpts...), "upgrade"),
	"apt.full_upgrade":  append(append([]string{"/usr/bin/apt-get"}, aptOpts...), "full-upgrade"),
	"apt.autoremove":    append(append([]string{"/usr/bin/apt-get"}, aptOpts...), "autoremove", "--purge"),
	// Çıkış kodu 1 = dosya yok = yeniden başlatma gerekmiyor.
	"reboot.required": {"/bin/cat", "/var/run/reboot-required"},
	"disk.usage":      {"/bin/df", "-hT", "-x", "tmpfs", "-x", "devtmpfs", "-x", "overlay"},
	"memory.usage":    {"/usr/bin/free", "-h"},
	"uptime":          {"/usr/bin/uptime"},
	"top.processes":   {"/bin/ps", "-eo", "pid,user,pcpu,pmem,comm", "--sort=-pcpu"},
	"journal.errors":  {"/usr/bin/journalctl", "-p", "err", "-n", "200", "--no-pager"},
	"docker.df":       {"/usr/bin/docker", "system", "df"},
	"docker.prune":    {"/usr/bin/docker", "system", "prune", "-f"},
}

func preset(a Args) (string, error) {
	key := a.str("preset", "")
	if _, ok := Presets[key]; !ok {
		return "", fmt.Errorf("bilinmeyen kalıp: %s", key)
	}
	return key, nil
}

func command(a Args) (string, error) {
	value := strings.TrimSpace(a.str("command", ""))
	if value == "" {
		return "", errInput("komut boş")
	}
	if utf8.RuneCountInString(value) > CommandMaxLength {
		return "", fmt.Errorf("komut çok uzun (en fazla %d karakter)", CommandMaxLength)
	}
	if strings.ContainsAny(value, "\x00\n\r") {
		return "", errInput("komut tek satır olmalı")
	}
	return value, nil
}

type builder func(Args) ([]string, error)

func fixed(argv ...string) builder {
	return func(Args) ([]string, error) { return argv, nil }
}

func with(prefix []string, arg func(Args) (string, error), suffix ...string) builder {
	return func(a Args) ([]string, error) {
		value, err := arg(a)
		if err != nil {
			return nil, err
		}
		out := append(append(append([]string{}, prefix...), value), suffix...)
		return out, nil
	}
}

func compose(sub ...string) builder {
	return with([]string{"/usr/bin/docker", "compose", "--project-directory"}, projectDir, sub...)
}

// Actions — eylem tablosu (panel-helper.py ACTIONS).
var Actions = map[string]builder{
	"power.reboot": func(a Args) ([]string, error) {
		d, err := delay(a)
		return []string{"/sbin/shutdown", "-r", "+" + d}, err
	},
	"power.shutdown": func(a Args) ([]string, error) {
		d, err := delay(a)
		return []string{"/sbin/shutdown", "-h", "+" + d}, err
	},
	"power.cancel": fixed("/sbin/shutdown", "-c"),
	"service.status": with([]string{"/usr/bin/systemctl", "show"}, unit,
		"--property=Id,LoadState,ActiveState,SubState,UnitFileState,Description,ExecMainStartTimestamp", "--no-pager"),
	"service.restart": with([]string{"/usr/bin/systemctl", "restart"}, unit),
	"service.start":   with([]string{"/usr/bin/systemctl", "start"}, unit),
	"service.stop":    with([]string{"/usr/bin/systemctl", "stop"}, unit),
	"service.list":    fixed("/usr/bin/systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain"),
	"journal.read": func(a Args) ([]string, error) {
		since, err := journalSince(a)
		if err != nil {
			return nil, err
		}
		lines, err := journalLines(a)
		if err != nil {
			return nil, err
		}
		return []string{"/usr/bin/journalctl", "--since", since, "--lines", lines, "--output", "json", "--no-pager"}, nil
	},
	"fail2ban.status": fixed("/usr/bin/fail2ban-client", "status"),
	"fail2ban.jail":   with([]string{"/usr/bin/fail2ban-client", "status"}, jail),
	"fail2ban.unban": func(a Args) ([]string, error) {
		j, err := jail(a)
		if err != nil {
			return nil, err
		}
		address, err := ip(a)
		if err != nil {
			return nil, err
		}
		return []string{"/usr/bin/fail2ban-client", "set", j, "unbanip", address}, nil
	},
	"cron.list":        with([]string{"/usr/bin/crontab", "-l", "-u"}, cronUser),
	"cron.list_system": fixed("/bin/cat", "/etc/crontab"),
	"compose.ps":       compose("ps", "--format", "json"),
	"compose.config":   compose("config"),
	"compose.up":       compose("up", "-d"),
	"compose.pull":     compose("pull"),
	"compose.restart":  compose("restart"),
	"compose.down":     compose("down"),
	"shell.preset": func(a Args) ([]string, error) {
		key, err := preset(a)
		if err != nil {
			return nil, err
		}
		return Presets[key], nil
	},
	"shell.exec": func(a Args) ([]string, error) {
		c, err := command(a)
		if err != nil {
			return nil, err
		}
		return []string{"/bin/bash", "-lc", c}, nil
	},
}

var consoleActions = map[string]bool{"shell.preset": true, "shell.exec": true}

// subjectKey — eylemin komuta GİREN ana argümanı; desen yalnız buna
// uygulanır. Genel bir öncelik listesi ("unit, yoksa dir…") kullanmak açıktı:
// `compose.up`'a izinli bir `unit` ile izinsiz bir `dir` birlikte
// gönderilince desen `unit`'e bakar, komut `dir`'de çalışırdı (güvenlik
// incelemesi 2026-10-14; panel-helper.py'de de düzeltildi).
var subjectKey = map[string]string{
	"service.status":  "unit",
	"service.restart": "unit",
	"service.start":   "unit",
	"service.stop":    "unit",
	"compose.ps":      "dir",
	"compose.config":  "dir",
	"compose.up":      "dir",
	"compose.pull":    "dir",
	"compose.restart": "dir",
	"compose.down":    "dir",
	"shell.preset":    "preset",
	"shell.exec":      "command",
	"fail2ban.jail":   "jail",
	"fail2ban.unban":  "jail",
	"cron.list":       "user",
}

// Subject — eylemin desenle sınanan argümanı (komutta kullanılanın aynısı;
// shell.exec için kırpılmış metin). Ana argümanı olmayan eylemde "".
func Subject(action string, a Args) string {
	key, ok := subjectKey[action]
	if !ok {
		return ""
	}
	value := a.str(key, "")
	if action == "shell.exec" {
		value = strings.TrimSpace(value)
	}
	return value
}

// Response — merkezdeki HelperResponse (alan sırası helper ile aynı).
type Response struct {
	OK         bool    `json:"ok"`
	ExitCode   *int    `json:"exitCode,omitempty"`
	Stdout     *string `json:"stdout,omitempty"`
	Stderr     *string `json:"stderr,omitempty"`
	DurationMs *int64  `json:"durationMs,omitempty"`
	Error      string  `json:"error,omitempty"`
}

func fail(message string) Response { return Response{OK: false, Error: message} }

// Decide — izin kararı; policy paketinden enjekte edilir (döngüsel import yok).
// allowed=false ise reason "action" (eylem kapalı) ya da "pattern" (desen).
type Decide func(action, subject string) (allowed bool, reason string)

// Logf — çalıştırılan komutların kaydı (journald).
type Logf func(format string, args ...any)

func truncateRunes(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	runes := []rune(text)
	return string(runes[:limit])
}

// commandPath — çalıştırılacak ikilinin yolu. Testler bunu var olmayan bir
// klasöre yönlendirir: test asla gerçek sistem komutu (shutdown, systemctl…)
// çalıştırmamalı (CI'da `shutdown -c` gerçekten çalışıp testi bozmuştu).
var commandPath = func(path string) string { return path }

// Run — eylemi doğrular ve çalıştırır.
func Run(ctx context.Context, action string, args Args, actor string, decide Decide, logf Logf) Response {
	build, known := Actions[action]
	if !known {
		logf("RED: bilinmeyen eylem %s", action)
		return fail("bilinmeyen eylem: " + action)
	}
	subject := Subject(action, args)
	if allowed, reason := decide(action, subject); !allowed {
		if reason == "pattern" {
			logf("RED: argüman izin desenine uymuyor (%s: %s)", action, subject)
			return fail("argüman izin verilen desene uymuyor")
		}
		logf("RED: izinsiz eylem %s (isteyen: %s)", action, actor)
		return fail("eylem izinli değil: " + action)
	}
	argv, err := build(args)
	if err != nil {
		return fail("geçersiz argüman: " + err.Error())
	}
	timeout := CommandTimeout
	if consoleActions[action] {
		timeout = ConsoleTimeout
	}
	logf("ÇALIŞTIR: %s (isteyen: %s) → %s", action, actor, strings.Join(argv, " "))
	started := time.Now()
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, commandPath(argv[0]), argv[1:]...)
	if consoleActions[action] {
		cmd.Env = append(os.Environ(), consoleEn...)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	if runCtx.Err() == context.DeadlineExceeded {
		return fail(fmt.Sprintf("komut %d saniyede bitmedi ve kesildi", int(timeout.Seconds())))
	}
	exitCode := 0
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			return fail("komut bulunamadı: " + argv[0])
		}
	}
	out := truncateRunes(strings.ToValidUTF8(stdout.String(), "�"), 100000)
	errText := truncateRunes(strings.ToValidUTF8(stderr.String(), "�"), 10000)
	duration := time.Since(started).Milliseconds()
	return Response{OK: exitCode == 0, ExitCode: &exitCode, Stdout: &out, Stderr: &errText, DurationMs: &duration}
}
