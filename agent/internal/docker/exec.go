package docker

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Etkileşimli terminal (`exec.*`). Oturum MERKEZDE kullanıcıya bağlı; ajan
// yalnızca exec'i açar, çıktıyı akıtır, girişi yazar (src/lib/docker/exec.ts
// ajan tarafıyla aynı sözleşme). Hijack edilmiş soket iki yönlü ve tek;
// çağrılar arasında yaşaması için oturumlar bellekte.

// ExecOptions — merkezin `exec.start`'a gönderdiği seçenekler.
type ExecOptions struct {
	ContainerID string
	Shell       string // boş = ayar `docker.exec_shell`
	User        string // boş = imajın varsayılanı
	Cols, Rows  int
}

// ExecErrors — kullanıcıya dönen metinler (dil merkezden gelen ayara göre).
type ExecErrors struct {
	NotFound, NotRunning, NotFoundSession string
	CreateFailed                          func(status int, raw string) string
}

type session struct {
	id       string
	execID   string
	stream   *Hijacked
	mu       sync.Mutex
	pending  []byte
	wake     chan struct{}
	closed   bool
	lastSeen time.Time
}

// Execs — açık oturumlar.
type Execs struct {
	Client *Client
	// IdleTimeout — terk edilmiş oturum kapatılır (ayar docker.exec_idle_minutes).
	IdleTimeout func() time.Duration

	mu       sync.Mutex
	sessions map[string]*session
	reaper   bool
}

// ShellCommand — "auto": kabuk container içinde aranır (Alpine'de bash yok).
func ShellCommand(shell string) []string {
	if shell != "auto" {
		return []string{shell}
	}
	return []string{"/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"}
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Start — exec oluşturur, hijack eder, boyutu ayarlar.
func (e *Execs) Start(ctx context.Context, opt ExecOptions, defaultShell string, msg ExecErrors) (string, error) {
	shell := strings.TrimSpace(opt.Shell)
	if shell == "" {
		shell = defaultShell
	}
	spec := map[string]any{
		"AttachStdin": true, "AttachStdout": true, "AttachStderr": true, "Tty": true,
		"Cmd": ShellCommand(shell),
	}
	if opt.User != "" {
		spec["User"] = opt.User
	}
	payload, _ := json.Marshal(spec)
	created, err := e.Client.JSON(ctx, "POST", "/containers/"+url.PathEscape(opt.ContainerID)+"/exec", payload)
	if err != nil {
		return "", err
	}
	var info struct{ Id string }
	_ = json.Unmarshal(created.Body, &info)
	if created.Status != 201 || info.Id == "" {
		switch created.Status {
		case 404:
			return "", errors.New(msg.NotFound)
		case 409:
			return "", errors.New(msg.NotRunning)
		default:
			raw := string(created.Body)
			if len(raw) > 160 {
				raw = raw[:160]
			}
			return "", errors.New(msg.CreateFailed(created.Status, raw))
		}
	}

	// Hijack bağlantısı isteğin değil oturumun ömrüne bağlı.
	stream, err := e.Client.Hijack(context.Background(), "/exec/"+info.Id+"/start", []byte(`{"Detach":false,"Tty":true}`))
	if err != nil {
		return "", err
	}
	s := &session{id: newID(), execID: info.Id, stream: stream, wake: make(chan struct{}, 1), lastSeen: time.Now()}
	e.mu.Lock()
	if e.sessions == nil {
		e.sessions = map[string]*session{}
	}
	e.sessions[s.id] = s
	if !e.reaper {
		e.reaper = true
		go e.reap()
	}
	e.mu.Unlock()

	go s.pump()
	_ = e.Resize(ctx, s.id, opt.Cols, opt.Rows, msg)
	return s.id, nil
}

func (s *session) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// pump — Docker'dan gelen çıktıyı biriktirir.
func (s *session) pump() {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.stream.Read(buf)
		if n > 0 {
			s.mu.Lock()
			s.pending = append(s.pending, buf[:n]...)
			s.mu.Unlock()
			s.signal()
		}
		if err != nil {
			s.mu.Lock()
			s.closed = true
			s.mu.Unlock()
			s.signal()
			return
		}
	}
}

func (e *Execs) get(id string, msg ExecErrors) (*session, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.sessions[id]
	if s == nil {
		return nil, errors.New(msg.NotFoundSession)
	}
	s.mu.Lock()
	s.lastSeen = time.Now()
	s.mu.Unlock()
	return s, nil
}

// Input — girişi yazar (kapanmışsa sessizce yok sayar, Node gibi).
func (e *Execs) Input(id, data string, msg ExecErrors) error {
	s, err := e.get(id, msg)
	if err != nil {
		return err
	}
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return nil
	}
	_, err = s.stream.Write([]byte(data))
	return err
}

// Resize — terminal boyutu.
func (e *Execs) Resize(ctx context.Context, id string, cols, rows int, msg ExecErrors) error {
	s, err := e.get(id, msg)
	if err != nil {
		return err
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	_, err = e.Client.JSON(ctx, "POST", fmt.Sprintf("/exec/%s/resize?h=%d&w=%d", s.execID, rows, cols), nil)
	return err
}

// Close — oturumu kapatır.
func (e *Execs) Close(id string) {
	e.mu.Lock()
	s := e.sessions[id]
	delete(e.sessions, id)
	e.mu.Unlock()
	if s != nil {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		_ = s.stream.Close()
		s.signal()
	}
}

// ExitCode — kabuk bittiyse çıkış kodu, sürüyorsa nil.
func (e *Execs) ExitCode(ctx context.Context, execID string) *float64 {
	resp, err := e.Client.JSON(ctx, "GET", "/exec/"+execID+"/json", nil)
	if err != nil {
		return nil
	}
	var info struct {
		Running  bool
		ExitCode *float64
	}
	if json.Unmarshal(resp.Body, &info) != nil || info.Running {
		return nil
	}
	if info.ExitCode == nil {
		zero := 0.0
		return &zero
	}
	return info.ExitCode
}

// Output — çıktıyı `{out}` çerçeveleri olarak akıtır; kabuk bitince son
// çerçeve `{exit}`. Yarım UTF-8 dizisi bir sonraki çerçeveye taşınır.
func (e *Execs) Output(ctx context.Context, id string, msg ExecErrors, emit func(any) error) error {
	s, err := e.get(id, msg)
	if err != nil {
		return err
	}
	var carry []byte
	for {
		s.mu.Lock()
		chunk := s.pending
		s.pending = nil
		closed := s.closed
		s.lastSeen = time.Now()
		s.mu.Unlock()

		if len(chunk) > 0 {
			data := append(carry, chunk...)
			cut := validPrefix(data)
			carry = append([]byte(nil), data[cut:]...)
			if cut > 0 {
				if err := emit(map[string]any{"out": string(data[:cut])}); err != nil {
					return err
				}
			}
			continue
		}
		if closed {
			if len(carry) > 0 {
				_ = emit(map[string]any{"out": strings.ToValidUTF8(string(carry), "�")})
			}
			if ctx.Err() == nil {
				var exit any
				if code := e.ExitCode(ctx, s.execID); code != nil {
					exit = *code
				}
				return emit(map[string]any{"exit": exit})
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-s.wake:
		}
	}
}

// validPrefix — sonda yarım kalmış çok baytlı karakter varsa onu dışarıda bırakır.
func validPrefix(data []byte) int {
	for back := 1; back <= 3 && back <= len(data); back++ {
		i := len(data) - back
		if utf8.RuneStart(data[i]) {
			if !utf8.FullRune(data[i:]) {
				return i
			}
			break
		}
	}
	return len(data)
}

func (e *Execs) reap() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		timeout := 30 * time.Minute
		if e.IdleTimeout != nil {
			timeout = e.IdleTimeout()
		}
		e.mu.Lock()
		var stale []string
		for id, s := range e.sessions {
			s.mu.Lock()
			if time.Since(s.lastSeen) > timeout {
				stale = append(stale, id)
			}
			s.mu.Unlock()
		}
		empty := len(e.sessions) == len(stale)
		if empty {
			e.reaper = false
		}
		e.mu.Unlock()
		for _, id := range stale {
			e.Close(id)
		}
		if empty {
			return
		}
	}
}
