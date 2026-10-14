package docker

import (
	"bufio"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// Ortak vektörler: merkezdeki docker-api-policy.ts ile aynı kararlar.

type vectorFile struct {
	DockerAPI struct {
		Check []struct {
			Method string         `json:"method"`
			Path   string         `json:"path"`
			Expect map[string]any `json:"expect"`
		} `json:"check"`
		Prepare []struct {
			Name   string         `json:"name"`
			Mode   string         `json:"mode"`
			Wire   string         `json:"wire"`
			Expect map[string]any `json:"expect"`
		} `json:"prepare"`
	} `json:"dockerApi"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "protocol", "vectors-v3.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v vectorFile
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestIzinListesiVektorleri(t *testing.T) {
	cases := loadVectors(t).DockerAPI.Check
	if len(cases) < 40 {
		t.Fatalf("vektör sayısı az: %d", len(cases))
	}
	for _, c := range cases {
		got := Check(c.Method, c.Path)
		if ok, _ := c.Expect["ok"].(bool); ok {
			if !got.OK || got.Method != c.Expect["method"] || got.Path != c.Expect["path"] {
				t.Errorf("%s %q: %+v ≠ %v", c.Method, c.Path, got, c.Expect)
			}
		} else if got.OK || got.Reason != c.Expect["reason"] {
			t.Errorf("%s %q: %+v ≠ ret %v", c.Method, c.Path, got, c.Expect["reason"])
		}
	}
}

func TestHazirlamaVektorleri(t *testing.T) {
	for _, c := range loadVectors(t).DockerAPI.Prepare {
		raw, err := protocol.Decode([]byte(c.Wire))
		if err != nil {
			t.Fatal(err)
		}
		got, reason := Prepare(raw, c.Mode == "stream")
		if ok, _ := c.Expect["ok"].(bool); !ok {
			if got != nil || reason != c.Expect["reason"] {
				t.Errorf("%s: %+v / %q ≠ ret %v", c.Name, got, reason, c.Expect["reason"])
			}
			continue
		}
		if got == nil {
			t.Errorf("%s: reddedildi (%s)", c.Name, reason)
			continue
		}
		want := c.Expect["request"].(map[string]any)
		headers, _ := json.Marshal(got.Headers)
		wantHeaders, _ := json.Marshal(want["headers"])
		if got.Method != want["method"] || got.Path != want["path"] || string(headers) != string(wantHeaders) || got.TimeoutMs != want["timeoutMs"].(float64) {
			t.Errorf("%s: %+v ≠ %v", c.Name, got, want)
		}
		if body, has := want["body"].(map[string]any); has {
			if hex.EncodeToString(got.Body) != body["$bytesHex"] || !got.HasBody {
				t.Errorf("%s: gövde %x", c.Name, got.Body)
			}
		} else if got.HasBody {
			t.Errorf("%s: beklenmeyen gövde", c.Name)
		}
	}
}

// Go'ya özgü: RE2'de ileri bakış olmadığı için kodla yazılan koruma.
func TestAyrilmisAdlar(t *testing.T) {
	for _, c := range []struct {
		method, path string
		ok           bool
	}{
		{"GET", "/images/nginx/json", true},
		{"GET", "/images/ghcr.io/a/b:1/json", true},
		{"GET", "/images/json/x/json", false},
		{"GET", "/images/load/json", false},
		{"DELETE", "/images/search", false},
		{"DELETE", "/images/nginx:1", true},
		{"GET", "/volumes/create", false},
		{"GET", "/volumes/veri", true},
		{"DELETE", "/networks/prune", false},
		{"GET", "/v1.47/networks/bridge", true},
	} {
		if got := Check(c.method, c.path); got.OK != c.ok {
			t.Errorf("%s %s: %+v", c.method, c.path, got)
		}
	}
}

// --- Sahte Docker daemon (unix soket) ---------------------------------------

type fakeDocker struct {
	socket string
	mu     sync.Mutex
	paths  []string
	input  strings.Builder
}

func startFake(t *testing.T) *fakeDocker {
	t.Helper()
	dir, err := os.MkdirTemp("", "dk")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	f := &fakeDocker{socket: filepath.Join(dir, "d.sock")}
	listener, err := net.Listen("unix", f.socket)
	if err != nil {
		t.Skipf("unix soket yok: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.paths = append(f.paths, r.Method+" "+r.URL.RequestURI())
		f.mu.Unlock()
		switch {
		case r.URL.Path == "/containers/json":
			w.Header().Set("content-type", "application/json")
			fmt.Fprint(w, `[{"Id":"abc"}]`)
		case r.URL.Path == "/events":
			w.Header().Set("content-type", "application/json")
			flusher := w.(http.Flusher)
			for i := 0; i < 3; i++ {
				fmt.Fprintf(w, `{"Action":"start","n":%d}`+"\n", i)
				flusher.Flush()
				time.Sleep(20 * time.Millisecond)
			}
		case r.URL.Path == "/containers/yok/json":
			w.WriteHeader(404)
			fmt.Fprint(w, `{"message":"No such container"}`)
		case r.URL.Path == "/containers/kapali/exec":
			w.WriteHeader(409)
		case strings.HasSuffix(r.URL.Path, "/exec") && r.Method == "POST":
			body, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(body), `"Tty":true`) {
				w.WriteHeader(400)
				return
			}
			w.WriteHeader(201)
			fmt.Fprint(w, `{"Id":"ex1"}`)
		case r.URL.Path == "/exec/ex1/start":
			conn, rw, _ := w.(http.Hijacker).Hijack()
			rw.WriteString("HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
			rw.WriteString("$ ")
			// Türkçe karakter iki parçaya bölünüyor: "ğ" = c4 9f.
			rw.Write([]byte{'a', 0xc4})
			rw.Flush()
			time.Sleep(30 * time.Millisecond)
			rw.Write([]byte{0x9f, 'b'})
			rw.Flush()
			reader := bufio.NewReader(conn)
			line, _ := reader.ReadString('\n')
			f.mu.Lock()
			f.input.WriteString(line)
			f.mu.Unlock()
			rw.WriteString("çıktı:" + line)
			rw.Flush()
			conn.Close()
		case r.URL.Path == "/exec/ex1/resize":
			w.WriteHeader(201)
		case r.URL.Path == "/exec/ex1/json":
			fmt.Fprint(w, `{"Running":false,"ExitCode":7}`)
		default:
			w.WriteHeader(404)
		}
	})
	server := &http.Server{Handler: mux}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	return f
}

func TestTunelCagriVeAkis(t *testing.T) {
	f := startFake(t)
	c := &Client{Socket: f.socket}
	if !c.Available() {
		t.Fatal("soket görünmüyor")
	}
	p, _ := Prepare(map[string]any{"method": "GET", "path": "/v1.47/containers/json?all=1"}, false)
	resp, err := c.Do(context.Background(), p)
	if err != nil || resp.Status != 200 || string(resp.Body) != `[{"Id":"abc"}]` || resp.Headers["content-type"] != "application/json" {
		t.Fatalf("çağrı: %+v %v", resp, err)
	}
	if f.paths[0] != "GET /containers/json?all=1" {
		t.Fatalf("sürüm öneki atılmadı: %v", f.paths)
	}
	p, _ = Prepare(map[string]any{"method": "GET", "path": "/containers/yok/json"}, false)
	if resp, _ := c.Do(context.Background(), p); resp.Status != 404 {
		t.Fatalf("404 taşınmadı: %+v", resp)
	}

	p, _ = Prepare(map[string]any{"method": "GET", "path": "/events"}, true)
	stream, err := c.Stream(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(stream.Body)
	stream.Body.Close()
	if strings.Count(string(data), "\n") != 3 {
		t.Fatalf("akış: %q", data)
	}

	// Kısa süre sınırı.
	p, _ = Prepare(map[string]any{"method": "GET", "path": "/events", "timeoutMs": float64(10)}, false)
	if _, err := c.Do(context.Background(), p); err != ErrTimeout {
		t.Fatalf("süre aşımı: %v", err)
	}
}

func TestTerminal(t *testing.T) {
	f := startFake(t)
	execs := &Execs{Client: &Client{Socket: f.socket}}
	msg := ExecErrors{NotFound: "yok", NotRunning: "çalışmıyor", NotFoundSession: "oturum yok",
		CreateFailed: func(s int, raw string) string { return fmt.Sprintf("hata %d", s) }}

	if _, err := execs.Start(context.Background(), ExecOptions{ContainerID: "kapali"}, "auto", msg); err == nil || err.Error() != "çalışmıyor" {
		t.Fatalf("409: %v", err)
	}
	id, err := execs.Start(context.Background(), ExecOptions{ContainerID: "web", Cols: 80, Rows: 24}, "auto", msg)
	if err != nil {
		t.Fatal(err)
	}
	if err := execs.Input(id, "ls\n", msg); err != nil {
		t.Fatal(err)
	}
	var frames []map[string]any
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err = execs.Output(ctx, id, msg, func(frame any) error {
		frames = append(frames, frame.(map[string]any))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	for _, frame := range frames[:len(frames)-1] {
		out.WriteString(frame["out"].(string))
	}
	if out.String() != "$ ağbçıktı:ls\n" {
		t.Fatalf("çıktı %q (yarım UTF-8 birleşmeli)", out.String())
	}
	if last := frames[len(frames)-1]; last["exit"] != 7.0 {
		t.Fatalf("çıkış kodu: %v", last)
	}
	if f.input.String() != "ls\n" {
		t.Fatalf("giriş: %q", f.input.String())
	}
	joined := strings.Join(f.paths, " | ")
	if !strings.Contains(joined, "POST /exec/ex1/resize?h=24&w=80") {
		t.Fatalf("boyut: %s", joined)
	}
	execs.Close(id)
	if err := execs.Input(id, "x", msg); err == nil || err.Error() != "oturum yok" {
		t.Fatalf("kapalı oturum: %v", err)
	}
}

func TestYarimUTF8(t *testing.T) {
	for _, c := range []struct {
		in   []byte
		want int
	}{
		{[]byte("abc"), 3},
		{[]byte{'a', 0xc4}, 1},
		{[]byte{'a', 0xe2, 0x82}, 1},
		{[]byte{0xc4, 0x9f}, 2},
		{[]byte{}, 0},
	} {
		if got := validPrefix(c.in); got != c.want {
			t.Errorf("%x: %d ≠ %d", c.in, got, c.want)
		}
	}
}
