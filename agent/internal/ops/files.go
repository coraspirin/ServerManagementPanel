package ops

import (
	"context"
	"errors"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/files"
	"github.com/coraspirin/servermanagementpanel/agent/internal/i18n"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// Dosya yöneticisi ve host'a bakan okuma işleri. Ayarlar (izinli kökler,
// sınırlar) merkezin isteğe eklediği `settings`'ten — ajan kendi kopyasını
// tutmaz; yol denetimi her istekte o anki köklerle.

func numberSetting(settings map[string]any, key string, fallback float64) float64 {
	if n, ok := settings[key].(float64); ok && n > 0 {
		return n
	}
	return fallback
}

func (a *Agent) fs(settings map[string]any) files.Fs {
	locale := i18n.Locale(settings)
	return files.Fs{Base: a.Roots.Root, Protected: a.Protected, T: func(key string, params map[string]any) string {
		return i18n.T(locale, key, params)
	}}
}

func registerFiles(r *Registry, a *Agent) {
	call := func(name string, fn func(ctx context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error)) {
		r.ops[name] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
			return fn(ctx, req, a.fs(req.Settings), files.Roots(req.Settings))
		}}
	}

	call("files.list", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		return fs.List(rawPath(req.Args, 0), roots)
	})
	call("files.read", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		return fs.Read(stringArg(req.Args, 0), roots, int64(numberSetting(req.Settings, "files.max_edit_kb", 512))*1024)
	})
	call("files.usage", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		budget := time.Duration(numberSetting(req.Settings, "files.scan_timeout_seconds", 20) * float64(time.Second))
		return fs.Usage(stringArg(req.Args, 0), roots, budget)
	})
	r.ops["files.download"] = Op{Stream: func(ctx context.Context, req *protocol.RpcRequest, emit func(any) error) error {
		return a.fs(req.Settings).Download(ctx, stringArg(req.Args, 0), files.Roots(req.Settings), emit,
			func(chunk []byte) any { return protocol.Bytes(chunk) })
	}}
	call("files.mkdir", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		return fs.Mkdir(stringArg(req.Args, 0), roots), nil
	})
	call("files.remove", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		recursive := len(req.Args) > 1 && req.Args[1] == true
		return fs.Remove(stringArg(req.Args, 0), roots, recursive), nil
	})
	call("files.rename", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		return fs.Rename(stringArg(req.Args, 0), roots, stringArg(req.Args, 1)), nil
	})
	call("files.chmod", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		return fs.Chmod(stringArg(req.Args, 0), roots, stringArg(req.Args, 1)), nil
	})
	call("files.write", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		var content protocol.Bytes
		if len(req.Args) > 1 {
			content, _ = req.Args[1].(protocol.Bytes)
		}
		if content == nil {
			return nil, errors.New(i18n.T(i18n.Locale(req.Settings), "api.invalidRequest", nil))
		}
		return fs.Write(stringArg(req.Args, 0), roots, content), nil
	})
	call("files.cleanupScan", func(_ context.Context, _ *protocol.RpcRequest, fs files.Fs, _ []string) (any, error) {
		return fs.CleanupScan(), nil
	})
	call("files.cleanupRun", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, roots []string) (any, error) {
		return fs.CleanupRun(stringArg(req.Args, 0), roots), nil
	})

	call("host.listDirs", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, _ []string) (any, error) {
		return fs.ListDirs(rawPath(req.Args, 0)), nil
	})
	call("host.dirExists", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, _ []string) (any, error) {
		return fs.DirExists(rawPath(req.Args, 0)), nil
	})
	call("host.accounts", func(_ context.Context, _ *protocol.RpcRequest, fs files.Fs, _ []string) (any, error) {
		return fs.Accounts(), nil
	})
	call("updates.osReport", func(_ context.Context, req *protocol.RpcRequest, _ files.Fs, _ []string) (any, error) {
		return files.OsReport(a.ReportsDir, numberSetting(req.Settings, "updates.report_stale_hours", 48), a.Now()), nil
	})
	call("backup.scanDir", func(_ context.Context, req *protocol.RpcRequest, fs files.Fs, _ []string) (any, error) {
		return fs.ScanWatchDir(stringArg(req.Args, 0)), nil
	})
}

// rawPath — Node'da `String(args[0] ?? "/")`.
func rawPath(args []any, i int) string {
	if value := stringArg(args, i); value != "" {
		return value
	}
	return "/"
}
