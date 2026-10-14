package docker

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// Client — docker.sock üzerinden HTTP. Ajan host'ta root çalıştığı için
// soket doğrudan açılır (DOCKER_SOCKET ile değiştirilebilir).
type Client struct {
	Socket string
}

// DefaultSocket — DOCKER_SOCKET ya da /var/run/docker.sock.
func DefaultSocket() string {
	if value := strings.TrimSpace(os.Getenv("DOCKER_SOCKET")); value != "" {
		return value
	}
	return "/var/run/docker.sock"
}

// Available — soket var mı (hello `capabilities.docker`).
func (c *Client) Available() bool {
	info, err := os.Stat(c.Socket)
	return err == nil && info.Mode()&os.ModeSocket != 0
}

func (c *Client) dial(ctx context.Context) (net.Conn, error) {
	var d net.Dialer
	return d.DialContext(ctx, "unix", c.Socket)
}

// Her istek kendi bağlantısında: Node tarafındaki "süresiz akış boşta
// kopmasın" dersinden (2026-10-14) — paylaşılan bağlantı havuzu yok.
func (c *Client) transport() *http.Transport {
	return &http.Transport{
		DialContext:       func(ctx context.Context, _, _ string) (net.Conn, error) { return c.dial(ctx) },
		DisableKeepAlives: true,
	}
}

func (c *Client) newRequest(ctx context.Context, p *Prepared) (*http.Request, error) {
	var body io.Reader
	if p.HasBody {
		body = bytes.NewReader(p.Body)
	}
	req, err := http.NewRequestWithContext(ctx, p.Method, "http://docker"+p.Path, body)
	if err != nil {
		return nil, err
	}
	for key, value := range p.Headers {
		req.Header.Set(key, value)
	}
	if p.HasBody {
		req.ContentLength = int64(len(p.Body))
	}
	return req, nil
}

// replyHeaders — merkeze yalnız içerik türü döner (Node ajanla aynı).
func replyHeaders(h http.Header) map[string]string {
	out := map[string]string{}
	if ct := h.Get("content-type"); ct != "" {
		out["content-type"] = ct
	}
	return out
}

// Response — `docker.api` yanıtı (alan sırası Node ile aynı).
type Response struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"-"`
}

// ErrTimeout — ara bellekli istek süresini aştı.
var ErrTimeout = errors.New("docker yanıt vermedi (süre aşımı)")

// Do — ara bellekli istek (gövde tamamen okunur).
func (c *Client) Do(ctx context.Context, p *Prepared) (*Response, error) {
	if p.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(p.TimeoutMs)*time.Millisecond)
		defer cancel()
	}
	req, err := c.newRequest(ctx, p)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Transport: c.transport()}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, ErrTimeout
		}
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, ErrTimeout
		}
		return nil, err
	}
	return &Response{Status: resp.StatusCode, Headers: replyHeaders(resp.Header), Body: data}, nil
}

// Stream — süresiz akış (loglar, olaylar, imaj çekme). Kapanış: ctx iptali
// (merkez bağlantıyı bıraktı) ya da Docker'ın akışı bitirmesi.
func (c *Client) Stream(ctx context.Context, p *Prepared) (*http.Response, error) {
	req, err := c.newRequest(ctx, p)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Transport: c.transport()}
	return client.Do(req)
}

// Hijacked — `/exec/{id}/start` sonrası iki yönlü ham akış.
type Hijacked struct {
	conn   net.Conn
	reader *bufio.Reader
}

func (h *Hijacked) Read(p []byte) (int, error)  { return h.reader.Read(p) }
func (h *Hijacked) Write(p []byte) (int, error) { return h.conn.Write(p) }
func (h *Hijacked) Close() error                { return h.conn.Close() }

// Hijack — POST isteği Upgrade ile gönderir; yanıt başlıklarından sonra
// bağlantı ham akışa dönüşür (Docker 101 ya da 200 döner).
func (c *Client) Hijack(ctx context.Context, path string, body []byte) (*Hijacked, error) {
	conn, err := c.dial(ctx)
	if err != nil {
		return nil, err
	}
	request := fmt.Sprintf("POST %s HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n", path, len(body))
	if _, err := conn.Write(append([]byte(request), body...)); err != nil {
		conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, nil)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols && resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		conn.Close()
		return nil, fmt.Errorf("exec start: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return &Hijacked{conn: conn, reader: reader}, nil
}

// JSON — küçük yardımcı istekler (exec oluşturma, boyut, durum).
func (c *Client) JSON(ctx context.Context, method, path string, body []byte) (*Response, error) {
	p := &Prepared{Method: method, Path: path, Headers: map[string]string{}, TimeoutMs: 10_000}
	if body != nil {
		p.Body, p.HasBody = body, true
		p.Headers["content-type"] = "application/json"
	}
	return c.Do(ctx, p)
}
