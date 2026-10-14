package ops

import (
	"context"
	"io"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/docker"
	"github.com/coraspirin/servermanagementpanel/agent/internal/i18n"
	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// Docker: ham Engine API tüneli (K2) + etkileşimli terminal. Native ajan
// sağlayıcı RPC'sini (`docker.list`…) SUNMAZ — merkez `dockerRpc: false`
// görünce her zaman tüneli kullanır; şekillendirme merkezde.

// apiResponse — merkezdeki DockerApiResponse (alan sırası aynı).
type apiResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    protocol.Bytes    `json:"body"`
}

type apiHead struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
}

func denied(reason string) error {
	return protocol.Errorf("docker-api-denied", "docker-api-denied:%s", reason)
}

func stringSetting(settings map[string]any, key, fallback string) string {
	if value, ok := settings[key].(string); ok && value != "" {
		return value
	}
	return fallback
}

func numberArg(value any) int {
	if n, ok := value.(float64); ok {
		return int(n)
	}
	return 0
}

func stringArg(args []any, i int) string {
	if i < len(args) {
		if s, ok := args[i].(string); ok {
			return s
		}
	}
	return ""
}

func execMessages(settings map[string]any) docker.ExecErrors {
	locale := i18n.Locale(settings)
	return docker.ExecErrors{
		NotFound:        i18n.T(locale, "dockerUpdate.notFound", nil),
		NotRunning:      i18n.T(locale, "execLib.notRunning", nil),
		NotFoundSession: i18n.T(locale, "api.notFound.session", nil),
		CreateFailed: func(status int, raw string) string {
			return i18n.T(locale, "execLib.createFailed", map[string]any{"status": status, "raw": raw})
		},
	}
}

// writeAllowed — GET/HEAD dışı Docker isteği politikada `docker.write`
// ister (readonly profil Docker'ı yalnız okur). Politika yoksa (testler) serbest.
func (a *Agent) writeAllowed(method string) error {
	if method == "GET" || method == "HEAD" || a.Policy == nil {
		return nil
	}
	current, err := a.Policy.Current()
	if err != nil {
		return protocol.Errorf("policy-invalid", "policy-invalid:%v", err)
	}
	if !current.Allowed(policy.DockerWrite) {
		return protocol.Errorf("policy-denied", "policy-denied:%s", policy.DockerWrite)
	}
	return nil
}

func registerDocker(r *Registry, a *Agent) {
	client := a.Docker
	execs := &docker.Execs{Client: client, IdleTimeout: func() time.Duration { return time.Duration(a.execIdle.Load()) }}

	r.ops["docker.api"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		var raw any
		if len(req.Args) > 0 {
			raw = req.Args[0]
		}
		prepared, reason := docker.Prepare(raw, false)
		if prepared == nil {
			return nil, denied(reason)
		}
		if err := a.writeAllowed(prepared.Method); err != nil {
			return nil, err
		}
		reply, err := client.Do(ctx, prepared)
		if err != nil {
			return nil, err
		}
		return apiResponse{Status: reply.Status, Headers: reply.Headers, Body: protocol.Bytes(reply.Body)}, nil
	}}

	// İlk çerçeve {status, headers}, sonrakiler gövde parçaları; 2xx değilse
	// gövde tek parça gelir ve akış biter.
	r.ops["docker.apiStream"] = Op{Stream: func(ctx context.Context, req *protocol.RpcRequest, emit func(any) error) error {
		var raw any
		if len(req.Args) > 0 {
			raw = req.Args[0]
		}
		prepared, reason := docker.Prepare(raw, true)
		if prepared == nil {
			return denied(reason)
		}
		if err := a.writeAllowed(prepared.Method); err != nil {
			return err
		}
		resp, err := client.Stream(ctx, prepared)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		headers := map[string]string{}
		if ct := resp.Header.Get("content-type"); ct != "" {
			headers["content-type"] = ct
		}
		if err := emit(apiHead{Status: resp.StatusCode, Headers: headers}); err != nil {
			return err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			data, _ := io.ReadAll(resp.Body)
			return emit(protocol.Bytes(data))
		}
		buf := make([]byte, 64*1024)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				if emitErr := emit(protocol.Bytes(append([]byte(nil), buf[:n]...))); emitErr != nil {
					return emitErr
				}
			}
			if err == io.EOF || ctx.Err() != nil {
				return nil
			}
			if err != nil {
				return err
			}
		}
	}}

	r.ops["exec.start"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		opts, _ := argMap(req.Args, 0)
		a.setExecIdle(req.Settings)
		id, err := execs.Start(ctx, docker.ExecOptions{
			ContainerID: stringOf(opts["containerId"]),
			Shell:       stringOf(opts["shell"]),
			User:        stringOf(opts["user"]),
			Cols:        numberArg(opts["cols"]),
			Rows:        numberArg(opts["rows"]),
		}, stringSetting(req.Settings, "docker.exec_shell", "auto"), execMessages(req.Settings))
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id}, nil
	}}
	r.ops["exec.output"] = Op{Stream: func(ctx context.Context, req *protocol.RpcRequest, emit func(any) error) error {
		return execs.Output(ctx, stringArg(req.Args, 0), execMessages(req.Settings), emit)
	}}
	r.ops["exec.input"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		return protocol.Undefined{}, execs.Input(stringArg(req.Args, 0), stringArg(req.Args, 1), execMessages(req.Settings))
	}}
	r.ops["exec.resize"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		var cols, rows int
		if len(req.Args) > 2 {
			cols, rows = numberArg(req.Args[1]), numberArg(req.Args[2])
		}
		return protocol.Undefined{}, execs.Resize(ctx, stringArg(req.Args, 0), cols, rows, execMessages(req.Settings))
	}}
	r.ops["exec.close"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		execs.Close(stringArg(req.Args, 0))
		return protocol.Undefined{}, nil
	}}
}

func argMap(args []any, i int) (map[string]any, bool) {
	if i < len(args) {
		m, ok := args[i].(map[string]any)
		return m, ok
	}
	return map[string]any{}, false
}

func stringOf(value any) string {
	s, _ := value.(string)
	return s
}

// setExecIdle — boşta kalan terminalin kapanma süresi (ayar, dakika).
func (a *Agent) setExecIdle(settings map[string]any) {
	minutes := 30.0
	if n, ok := settings["docker.exec_idle_minutes"].(float64); ok && n > 0 {
		minutes = n
	}
	a.execIdle.Store(int64(minutes * float64(time.Minute)))
}
