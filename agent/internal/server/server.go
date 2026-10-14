// Package server — ajanın HTTPS uçları; merkezdeki src/lib/agent/server.ts
// ile aynı davranış (durum kodları, hata gövdeleri, NDJSON akışı).
//
//	POST /api/agent/rpc     imzalı op çağrısı → {ok,value} | {ok:false,error}
//	POST /api/agent/stream  imzalı akış → NDJSON {t:"d"|"end"|"err"}
//	POST /api/agent/enroll  imzalı kayıt → {fingerprint, proof, hello}
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"runtime/debug"
	"sync"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/ops"
	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// MaxBody — en büyük istek gövdesi. docker.api 256 MB gövde taşıyabilir;
// base64 + JSON zarfı için pay bırakıldı.
const MaxBody = 360 << 20

// Server — uçların paylaştığı durum.
type Server struct {
	Secret      string
	Fingerprint string
	Registry    *ops.Registry
	Agent       *ops.Agent
	Policy      *policy.Store
	Now         func() time.Time
	Logf        func(format string, args ...any)
	// OnVerified — imzası doğrulanmış her istekten sonra (güncelleme onayı).
	OnVerified func()

	mu       sync.Mutex
	nonces   map[string]time.Time
	failures []time.Time
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Server) logf(format string, args ...any) {
	if s.Logf != nil {
		s.Logf(format, args...)
		return
	}
	log.Printf(format, args...)
}

// Handler — yalnız üç POST ucu; geri kalan her şey 404.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agent/rpc", s.post(s.handleRPC))
	mux.HandleFunc("/api/agent/stream", s.post(s.handleStream))
	mux.HandleFunc("/api/agent/enroll", s.post(s.handleEnroll))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) })
	return mux
}

func (s *Server) post(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		defer func() {
			if rec := recover(); rec != nil {
				s.logf("[agent] işlem çöktü: %v\n%s", rec, debug.Stack())
			}
		}()
		next(w, r)
	}
}

// --- Tekrar oynatma ve deneme sınırı ----------------------------------------

func (s *Server) rememberNonce(nonce string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if s.nonces == nil {
		s.nonces = map[string]time.Time{}
	}
	if len(s.nonces) > 10_000 {
		for key, expires := range s.nonces {
			if expires.Before(now) {
				delete(s.nonces, key)
			}
		}
	}
	if _, seen := s.nonces[nonce]; seen {
		return false
	}
	s.nonces[nonce] = now.Add(2 * protocol.ClockSkewSeconds * time.Second)
	return true
}

func (s *Server) locked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	since := s.now().Add(-time.Minute)
	kept := s.failures[:0]
	for _, at := range s.failures {
		if at.After(since) {
			kept = append(kept, at)
		}
	}
	s.failures = kept
	return len(s.failures) >= 20
}

func (s *Server) recordFailure() {
	s.mu.Lock()
	s.failures = append(s.failures, s.now())
	s.mu.Unlock()
}

// --- Ortak doğrulama ---------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeReply(w http.ResponseWriter, status int, reply protocol.Reply) {
	body, err := protocol.Encode(reply)
	if err != nil {
		body, _ = protocol.Encode(protocol.ErrReply(err))
		status = http.StatusOK
	}
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// verify — imzayı doğrular; başarısızsa yanıtı kendisi yazar ve nil döner.
func (s *Server) verify(w http.ResponseWriter, r *http.Request) []byte {
	if len(s.Secret) < 32 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent-not-configured"})
		return nil
	}
	if s.locked() {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "locked"})
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxBody+1))
	if err != nil || len(body) > MaxBody {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too-large"})
		return nil
	}
	ok, reason := protocol.Verify(s.Secret, protocol.VerifyInput{
		Method: r.Method,
		Path:   r.URL.Path,
		TS:     r.Header.Get(protocol.HeaderTS),
		Nonce:  r.Header.Get(protocol.HeaderNonce),
		Sig:    r.Header.Get(protocol.HeaderSig),
		Body:   body,
	}, s.now().Unix(), s.rememberNonce)
	if !ok {
		s.recordFailure()
		if reason == protocol.FailClock {
			// Pi'ye özgü (kararlar.md): saat kaymasında "imza geçersiz" yerine fark.
			s.logf("[agent] imza reddedildi (saat farkı) — istek %s, ajan %d", r.Header.Get(protocol.HeaderTS), s.now().Unix())
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": string(reason)})
		return nil
	}
	if s.OnVerified != nil {
		s.OnVerified()
	}
	return body
}

// resolve — op'u bulur, türünü ve politikayı denetler.
func (s *Server) resolve(w http.ResponseWriter, body []byte, stream bool) (*protocol.RpcRequest, ops.Op, bool) {
	req, ok := protocol.ParseRpc(body)
	if !ok {
		writeReply(w, http.StatusBadRequest, protocol.ErrReply(&protocol.RpcError{Message: "bad-request"}))
		return nil, ops.Op{}, false
	}
	op, found := s.Registry.Get(req.Op)
	if !found || (stream && op.Stream == nil) || (!stream && op.Call == nil) {
		writeReply(w, http.StatusNotFound, protocol.ErrReply(&protocol.RpcError{Message: "unknown-op:" + req.Op}))
		return nil, ops.Op{}, false
	}
	if s.Policy != nil {
		current, err := s.Policy.Current()
		if err != nil && !policy.Core[req.Op] {
			writeReply(w, http.StatusOK, protocol.ErrReply(protocol.Errorf("policy-invalid", "policy-invalid:%v", err)))
			return nil, ops.Op{}, false
		}
		if !current.Allowed(req.Op) {
			writeReply(w, http.StatusOK, protocol.ErrReply(protocol.Errorf("policy-denied", "policy-denied:%s", req.Op)))
			return nil, ops.Op{}, false
		}
	}
	return req, op, true
}

// --- Uçlar -----------------------------------------------------------------

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	body := s.verify(w, r)
	if body == nil {
		return
	}
	req, op, ok := s.resolve(w, body, false)
	if !ok {
		return
	}
	value, err := safeCall(r.Context(), op.Call, req)
	if err != nil {
		writeReply(w, http.StatusOK, protocol.ErrReply(err))
		return
	}
	writeReply(w, http.StatusOK, protocol.OkReply(value))
}

func safeCall(ctx context.Context, call ops.CallFunc, req *protocol.RpcRequest) (value any, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("op çöktü: %v", rec)
		}
	}()
	return call(ctx, req)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	body := s.verify(w, r)
	if body == nil {
		return
	}
	req, op, ok := s.resolve(w, body, true)
	if !ok {
		return
	}
	w.Header().Set("content-type", "application/x-ndjson")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)

	write := func(frame protocol.Frame) error {
		line, err := protocol.Encode(frame)
		if err != nil {
			return err
		}
		if _, err := w.Write(append(line, '\n')); err != nil {
			return err
		}
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	}

	err := func() (err error) {
		defer func() {
			if rec := recover(); rec != nil {
				err = fmt.Errorf("op çöktü: %v", rec)
			}
		}()
		return op.Stream(r.Context(), req, func(d any) error { return write(protocol.DataFrame(d)) })
	}()
	if r.Context().Err() != nil {
		return // merkez bağlantıyı kapattı
	}
	if err != nil {
		_ = write(protocol.ErrFrame(err))
		return
	}
	_ = write(protocol.EndFrame())
}

var enrollNonceRe = regexp.MustCompile(`^[0-9a-f]{32,64}$`)

// handleEnroll — merkez imzalı bir nonce gönderir; ajan sertifika parmak
// izini sırla imzalayıp döner. Merkez TLS'te GERÇEKTEN gördüğü parmak
// iziyle karşılaştırır.
func (s *Server) handleEnroll(w http.ResponseWriter, r *http.Request) {
	body := s.verify(w, r)
	if body == nil {
		return
	}
	var payload struct {
		Nonce any `json:"nonce"`
	}
	_ = json.Unmarshal(body, &payload)
	nonce, _ := payload.Nonce.(string)
	if !enrollNonceRe.MatchString(nonce) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad-nonce"})
		return
	}
	if s.Fingerprint == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no-certificate"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"fingerprint": s.Fingerprint,
		"proof":       protocol.EnrollProof(s.Secret, nonce, s.Fingerprint),
		"hello":       s.Agent.Hello(),
	})
}
