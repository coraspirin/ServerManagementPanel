// Package policy — host'un ajana izin verdiği işlemler (kararlar.md K3).
//
// Dosya host'ta, root'a ait: /etc/panel-agent/policy.conf. Panel bu dosyayı
// DEĞİŞTİREMEZ; ajan her istekte değişip değişmediğine bakar (mtime), yani
// düzenleme yeniden başlatma gerektirmez.
//
// Biçim (satır başına bir yönerge, # yorum):
//
//	profile standard                     # readonly | standard | full (varsayılan standard)
//	allow files.*                        # op: tam ad ya da "önek.*"
//	deny  power.*
//	allow helper.service.restart ^docker\.service$   # helper eylemi + isteğe bağlı desen
//
// Op kararı: deny > allow > profil. Çekirdek op'lar (hello, sistem bilgisi,
// metrikler, donanım) HER profilde açık ve kapatılamaz.
//
// Helper eylemleri (K4, `helper.call`): ad `helper.<eylem>`. Desen,
// host-helper allow.conf'taki gibi eylemin ana argümanına (birim, dizin,
// kalıp, komut) uygulanır. Bir eylem için AÇIK `allow` satırı varsa karar
// yalnız o satırlarla verilir (yazılan desen gerçekten kısıtlar); yoksa
// profil varsayılanı. Güç, root kabuğu ve geri alınamaz işler (paket
// yükseltme, docker prune) yalnız `full` profilde (kararlar.md).
package policy

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// lockedProfile — dosya okunamaz/bozukken: profil listesinde YOK, yani
// yalnız çekirdek op'lar açık (readonly artık okuma izni verdiği için yedek
// olarak kullanılamaz). Dosyaya yazılamaz (Parse reddeder).
const lockedProfile = "-"

// DefaultPath — systemd kurulumu; AGENT_POLICY ile değiştirilebilir.
const DefaultPath = "/etc/panel-agent/policy.conf"

// Core — her profilde açık, kapatılamaz.
var Core = map[string]bool{
	"agent.hello":     true,
	"system.info":     true,
	"metrics.sample":  true,
	"hardware.report": true,
	// Güncelleme: bozuk/eski bir ajanı düzeltmenin yolu, kapatılamaz. İkili
	// gömülü anahtarla imzalı olmak zorunda (update paketi).
	"agent.update":       true,
	"agent.updateStatus": true,
}

// Rule — ad deseni + isteğe bağlı argüman deseni (yalnız helper eylemleri).
type Rule struct {
	Name    string
	Pattern *regexp.Regexp
}

func rules(names ...string) []Rule {
	out := make([]Rule, 0, len(names))
	for _, name := range names {
		out = append(out, Rule{Name: name})
	}
	return out
}

// Salt-okunur konsol kalıpları.
var readonlyPresets = `^(disk\.usage|memory\.usage|uptime|top\.processes|journal\.errors|docker\.df|reboot\.required|apt\.list_upgrades)$`

var readonlyHelper = append(rules(
	"helper.call",
	"helper.service.status", "helper.service.list", "helper.journal.read",
	"helper.compose.ps", "helper.compose.config",
	"helper.cron.list", "helper.cron.list_system", "helper.fail2ban.status", "helper.fail2ban.jail",
), Rule{Name: "helper.shell.preset", Pattern: regexp.MustCompile(readonlyPresets)})

var standardHelper = append(rules(
	"helper.call",
	"helper.service.*", "helper.journal.read",
	"helper.compose.*",
	"helper.cron.list", "helper.cron.list_system", "helper.fail2ban.*",
), Rule{Name: "helper.shell.preset", Pattern: regexp.MustCompile(`^(disk\.usage|memory\.usage|uptime|top\.processes|journal\.errors|docker\.df|reboot\.required|apt\.list_upgrades|apt\.update)$`)})

// DockerWrite — sanal izin: Docker tünelinde GET/HEAD dışındaki her istek
// (container oluştur/başlat/sil, exec, imaj çek…) bunu ister (ops/docker.go).
// readonly'de kapalı; standard'da `deny docker.write` ile Docker salt okunur
// yapılabilir.
const DockerWrite = "docker.write"

// Salt okuma op'ları: dosya yöneticisinde listeleme/okuma/indirme/boyut,
// host okumaları, rapor ve yedek klasörü taraması.
var readonlyOps = rules(
	"docker.api", "docker.apiStream",
	"files.list", "files.read", "files.usage", "files.download", "files.cleanupScan",
	"host.*", "updates.osReport", "backup.scanDir",
)

// profileAllows — profil başına izinler (kararlar.md, kullanıcı onayı 2026-10-14).
var profileAllows = map[string][]Rule{
	// Her şeyi görür, hiçbir şeyi değiştirmez: Docker yalnız GET/HEAD,
	// dosyalar yalnız okuma, helper'da yalnız okuyan eylemler.
	"readonly": append(append([]Rule(nil), readonlyOps...), readonlyHelper...),
	// Docker tüneli (izin listesi ayrıca docker.Check'te), container terminali,
	// dosya yöneticisi (kökler merkezin `files.roots` ayarı), host okumaları,
	// servis/compose yönetimi.
	"standard": append(rules("docker.api", "docker.apiStream", DockerWrite, "exec.*", "files.*", "host.*", "updates.osReport", "backup.scanDir"), standardHelper...),
	"full":     rules("*"),
}

// Policy — ayrıştırılmış dosya.
type Policy struct {
	Profile string
	Allow   []Rule
	Deny    []string
	// Source — okunan dosya; yoksa "" (varsayılanlar).
	Source string
}

// Default — dosya yokken.
func Default() Policy { return Policy{Profile: "standard"} }

// Parse — dosya içeriği. Hatalı satır tüm dosyayı geçersiz kılar: yarım
// okunmuş bir politika sessizce daha geniş izin vermesin.
func Parse(content string) (Policy, error) {
	p := Default()
	scanner := bufio.NewScanner(strings.NewReader(content))
	line := 0
	for scanner.Scan() {
		line++
		text := scanner.Text()
		if i := strings.Index(text, "#"); i >= 0 {
			text = text[:i]
		}
		fields := strings.Fields(text)
		if len(fields) == 0 {
			continue
		}
		switch fields[0] {
		case "profile":
			if len(fields) != 2 {
				return Policy{}, fmt.Errorf("satır %d: beklenen \"profile <ad>\"", line)
			}
			if _, ok := profileAllows[fields[1]]; !ok {
				return Policy{}, fmt.Errorf("satır %d: bilinmeyen profil %q", line, fields[1])
			}
			p.Profile = fields[1]
		case "allow":
			if len(fields) < 2 {
				return Policy{}, fmt.Errorf("satır %d: beklenen \"allow <op> [desen]\"", line)
			}
			rule := Rule{Name: fields[1]}
			if len(fields) > 2 && !strings.HasPrefix(fields[1], "helper.") {
				// Desen yalnız helper eylemlerinde uygulanır; başka op'ta yok
				// sayılsaydı "allow files.read ^/var/log" op'u TAMAMEN açardı
				// (güvenlik incelemesi 2026-10-14).
				return Policy{}, fmt.Errorf("satır %d: desen yalnız helper.<eylem> satırlarında kullanılabilir", line)
			}
			if len(fields) > 2 {
				// Desen satırın geri kalanı (allow.conf gibi; boşluk içerebilir).
				rest := strings.TrimSpace(text[strings.Index(text, fields[1])+len(fields[1]):])
				pattern, err := regexp.Compile(rest)
				if err != nil {
					return Policy{}, fmt.Errorf("satır %d: desen derlenemedi: %v", line, err)
				}
				rule.Pattern = pattern
			}
			p.Allow = append(p.Allow, rule)
		case "deny":
			if len(fields) != 2 {
				return Policy{}, fmt.Errorf("satır %d: beklenen \"deny <op>\"", line)
			}
			p.Deny = append(p.Deny, fields[1])
		default:
			return Policy{}, fmt.Errorf("satır %d: bilinmeyen yönerge %q", line, fields[0])
		}
	}
	return p, nil
}

func matches(pattern, op string) bool {
	if pattern == "*" {
		return true
	}
	if strings.HasSuffix(pattern, ".*") {
		return strings.HasPrefix(op, strings.TrimSuffix(pattern, "*"))
	}
	return pattern == op
}

func anyName(patterns []string, op string) bool {
	for _, p := range patterns {
		if matches(p, op) {
			return true
		}
	}
	return false
}

func anyRule(list []Rule, op string) bool {
	for _, r := range list {
		if matches(r.Name, op) {
			return true
		}
	}
	return false
}

// Allowed — op bu politikada çalışabilir mi.
func (p Policy) Allowed(op string) bool {
	if Core[op] {
		return true
	}
	if anyName(p.Deny, op) {
		return false
	}
	if anyRule(p.Allow, op) {
		return true
	}
	return anyRule(profileAllows[p.Profile], op)
}

// Helper — helper eylemi için karar; reason "action" (kapalı) | "pattern"
// (açık ama argüman desene uymuyor).
func (p Policy) Helper(action, subject string) (bool, string) {
	name := "helper." + action
	if anyName(p.Deny, name) {
		return false, "action"
	}
	if decided, ok, reason := decide(p.Allow, name, subject); decided {
		return ok, reason
	}
	if decided, ok, reason := decide(profileAllows[p.Profile], name, subject); decided {
		return ok, reason
	}
	return false, "action"
}

// decide — listede bu adı kapsayan satır varsa karar verir: desensiz satır
// ya da desene uyan satır → izin; yalnız uymayan desenler → "pattern".
func decide(list []Rule, name, subject string) (decided, ok bool, reason string) {
	for _, r := range list {
		if !matches(r.Name, name) {
			continue
		}
		decided = true
		if r.Pattern == nil || r.Pattern.MatchString(subject) {
			return true, true, ""
		}
		reason = "pattern"
	}
	if decided {
		return true, false, reason
	}
	return false, false, ""
}

// HelperActions — bu politikada (desensiz ya da desenli) açık helper
// eylemleri; hello'da bildirilir, merkez yetki yoklamasında kullanır.
func (p Policy) HelperActions(all []string) []string {
	var out []string
	for _, action := range all {
		if anyName(p.Deny, "helper."+action) {
			continue
		}
		name := "helper." + action
		if anyRule(p.Allow, name) || anyRule(profileAllows[p.Profile], name) {
			out = append(out, action)
		}
	}
	return out
}

// Store — dosyayı mtime değişince yeniden okur.
type Store struct {
	Path string

	mu      sync.Mutex
	modTime time.Time
	size    int64
	loaded  bool
	current Policy
	err     error
}

// Current — güncel politika. Dosya bozuksa hata döner ve çağıran yalnız
// çekirdek op'lara izin verir (güvenli taraf).
func (s *Store) Current() (Policy, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, err := os.Stat(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			s.loaded, s.err = false, nil
			return Default(), nil
		}
		return Policy{Profile: lockedProfile}, err
	}
	if s.loaded && info.ModTime().Equal(s.modTime) && info.Size() == s.size {
		return s.current, s.err
	}
	content, err := os.ReadFile(s.Path)
	if err != nil {
		return Policy{Profile: lockedProfile}, err
	}
	p, parseErr := Parse(string(content))
	if parseErr == nil {
		p.Source = s.Path
	} else {
		p = Policy{Profile: lockedProfile, Source: s.Path}
	}
	s.current, s.err, s.loaded = p, parseErr, true
	s.modTime, s.size = info.ModTime(), info.Size()
	return s.current, s.err
}

// Profiles — geçerli profil adları (sıra: en dardan en genişe).
func Profiles() []string { return []string{"readonly", "standard", "full"} }

// Reason — `Allowed` kararının kaynağı (policy show için): "core" | "deny" |
// "allow" | "profile" | "" (kapalı).
func (p Policy) Reason(op string) string {
	switch {
	case Core[op]:
		return "core"
	case anyName(p.Deny, op):
		return "deny"
	case anyRule(p.Allow, op):
		return "allow"
	case anyRule(profileAllows[p.Profile], op):
		return "profile"
	}
	return ""
}
