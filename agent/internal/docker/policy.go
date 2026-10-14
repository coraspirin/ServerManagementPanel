// Package docker — ajanın docker.sock ile konuşması: ham Engine API tüneli
// (`docker.api` / `docker.apiStream`, kararlar.md K2) ve etkileşimli
// terminal (`exec.*`).
//
// Bu dosya tünelin izin listesi: merkezdeki src/lib/agent/docker-api-policy.ts
// ile BİREBİR; ikisi de protocol/vectors-v3.json `dockerApi` vektörleriyle
// sınanır. Liste KAPALI — yazılmayan her şey ret.
package docker

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

const (
	// MaxBody — tek istekte ajana gönderilebilecek en büyük gövde (arşiv yükleme).
	MaxBody = 256 * 1024 * 1024
	// MaxTimeoutMs — ara bellekli istekte en uzun süre (geçici container `wait`'i).
	MaxTimeoutMs = 6 * 60 * 60 * 1000
)

// Container/exec/ağ/volume kimliği ya da adı; düz eğik çizgi içermez.
const idPat = `(?:[A-Za-z0-9_.:@+-]|%[0-9A-Fa-f]{2})+`

// İmaj referansı; yüzde kodlu ya da düz eğik çizgi içerebilir.
const imagePat = `(?:[A-Za-z0-9_.:@+-]|%[0-9A-Fa-f]{2}|/)+`

type rule struct {
	methods []string
	pattern *regexp.Regexp
	// Go'nun RE2 motorunda negatif ileri bakış yok; Node kuralındaki
	// `(?!…)` denetimi burada: yakalanan ilk grup bu koşulu sağlamalı.
	guard func(first string) bool
}

func r(methods []string, source string, guard func(string) bool) rule {
	return rule{methods: methods, pattern: regexp.MustCompile("^" + source + "$"), guard: guard}
}

// İmaj adının ilk bölümü ayrılmış bir uç olamaz: /images/json, /images/load…
// (Node: `(?!(?:json|create|prune|load|search|get)(?:/|$))`).
func notReservedImage(image string) bool {
	head, _, _ := strings.Cut(image, "/")
	switch head {
	case "json", "create", "prune", "load", "search", "get":
		return false
	}
	return true
}

// Volume/ağ kimliği "create" ya da "prune" olamaz (Node: `(?!(?:create|prune)$)`).
func notCreatePrune(id string) bool { return id != "create" && id != "prune" }

var (
	get     = []string{"GET"}
	post    = []string{"POST"}
	del     = []string{"DELETE"}
	getHead = []string{"GET", "HEAD"}
	getDel  = []string{"GET", "DELETE"}
)

var rules = []rule{
	r(getHead, `/_ping`, nil),
	r(get, `/version`, nil),
	// Container'lar
	r(get, `/containers/json`, nil),
	r(post, `/containers/(?:create|prune)`, nil),
	r(get, `/containers/`+idPat+`/(?:json|logs|stats|top|changes)`, nil),
	r([]string{"GET", "HEAD", "PUT"}, `/containers/`+idPat+`/archive`, nil),
	r(post, `/containers/`+idPat+`/(?:start|stop|restart|kill|pause|unpause|rename|update|wait|exec|resize)`, nil),
	r(del, `/containers/`+idPat, nil),
	// İmajlar — load, search, push, toplu get yok
	r(get, `/images/json`, nil),
	r(post, `/images/(?:create|prune)`, nil),
	r(get, `/images/(`+imagePat+`)/(?:json|history|get)`, notReservedImage),
	r(post, `/images/(`+imagePat+`)/tag`, notReservedImage),
	r(del, `/images/(`+imagePat+`)`, notReservedImage),
	// Volume'ler
	r(get, `/volumes`, nil),
	r(post, `/volumes/(?:create|prune)`, nil),
	r(getDel, `/volumes/(`+idPat+`)`, notCreatePrune),
	// Ağlar
	r(get, `/networks`, nil),
	r(post, `/networks/(?:create|prune)`, nil),
	r(getDel, `/networks/(`+idPat+`)`, notCreatePrune),
	r(post, `/networks/`+idPat+`/(?:connect|disconnect)`, nil),
	// Exec — etkileşimli (hijack) oturum tünelden geçmez, `exec.*` op'ları ayrı
	r(post, `/exec/`+idPat+`/(?:start|resize)`, nil),
	r(get, `/exec/`+idPat+`/json`, nil),
	// Olaylar, disk kullanımı, derleme önbelleği temizliği
	r(get, `/events`, nil),
	r(get, `/system/df`, nil),
	r(post, `/build/prune`, nil),
}

var (
	methods      = map[string]bool{"GET": true, "HEAD": true, "POST": true, "PUT": true, "DELETE": true}
	badChars     = regexp.MustCompile("[\x00- \x7f#\\\\]")
	versionRe    = regexp.MustCompile(`^/v\d+\.\d+/`)
	dotSegmentRe = regexp.MustCompile(`(?:^|/)\.{1,2}(?:/|$)`)
)

// Decision — izinliyse sürüm öneki atılmış yol (sorgu dahil); değilse neden
// ("method" | "path" | "denied").
type Decision struct {
	OK     bool
	Method string
	Path   string
	Reason string
}

// Check — yöntem + yol (sorgu dahil) izinli mi.
func Check(method, rawPath string) Decision {
	upper := strings.ToUpper(method)
	if !methods[upper] {
		return Decision{Reason: "method"}
	}
	// Kontrol karakteri, boşluk, #, ters eğik çizgi: istek bölme / yol karıştırma.
	if !strings.HasPrefix(rawPath, "/") || badChars.MatchString(rawPath) {
		return Decision{Reason: "path"}
	}
	pathname, query := rawPath, ""
	if i := strings.Index(rawPath, "?"); i >= 0 {
		pathname, query = rawPath[:i], rawPath[i:]
	}
	if loc := versionRe.FindStringIndex(pathname); loc != nil {
		pathname = pathname[loc[1]-1:]
	}
	// Nokta bölümleri hem düz hem yüzde kodlu reddedilir: Docker `%2e%2e`'yi
	// `..` olarak görebilir.
	decoded, err := url.PathUnescape(pathname)
	if err != nil {
		return Decision{Reason: "path"}
	}
	if strings.Contains(pathname, "//") || dotSegmentRe.MatchString(decoded) {
		return Decision{Reason: "path"}
	}
	for _, rl := range rules {
		if !contains(rl.methods, upper) {
			continue
		}
		m := rl.pattern.FindStringSubmatch(pathname)
		if m == nil {
			continue
		}
		if rl.guard != nil && !rl.guard(m[1]) {
			continue
		}
		return Decision{OK: true, Method: upper, Path: pathname + query}
	}
	return Decision{Reason: "denied"}
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// FilterHeaders — yalnız `content-type` geçer (Upgrade/Connection YOK: hijack kapalı).
func FilterHeaders(headers any) map[string]string {
	out := map[string]string{}
	m, ok := headers.(map[string]any)
	if !ok {
		return out
	}
	for key, value := range m {
		name := strings.ToLower(key)
		text, isText := value.(string)
		if name == "content-type" && isText && !strings.ContainsAny(text, "\r\n") {
			out[name] = text
		}
	}
	return out
}

// Prepared — Docker'a gönderilecek istek.
type Prepared struct {
	Method    string            `json:"method"`
	Path      string            `json:"path"`
	Headers   map[string]string `json:"headers"`
	Body      []byte            `json:"-"`
	HasBody   bool              `json:"-"`
	TimeoutMs float64           `json:"timeoutMs"`
}

// Prepare — ağdan gelen DockerApiRequest'i doğrular. Hata nedenleri:
// "shape" | "method" | "path" | "denied" | "body". `stream` süre koymaz.
func Prepare(raw any, stream bool) (*Prepared, string) {
	input, ok := raw.(map[string]any)
	if !ok {
		return nil, "shape"
	}
	method, okMethod := input["method"].(string)
	path, okPath := input["path"].(string)
	if !okMethod || !okPath {
		return nil, "shape"
	}
	decision := Check(method, path)
	if !decision.OK {
		return nil, decision.Reason
	}
	prepared := &Prepared{Method: decision.Method, Path: decision.Path, Headers: FilterHeaders(input["headers"])}
	if body, present := input["body"]; present && body != nil {
		if _, undef := body.(protocol.Undefined); !undef {
			bytes, isBytes := body.(protocol.Bytes)
			if !isBytes {
				return nil, "shape"
			}
			if len(bytes) > MaxBody {
				return nil, "body"
			}
			prepared.Body, prepared.HasBody = bytes, true
		}
	}
	if !stream {
		prepared.TimeoutMs = MaxTimeoutMs
		if requested, isNum := input["timeoutMs"].(float64); isNum && requested > 0 {
			if requested < MaxTimeoutMs {
				prepared.TimeoutMs = requested
			}
		}
	}
	return prepared, ""
}
