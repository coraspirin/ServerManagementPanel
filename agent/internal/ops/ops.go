// Package ops — ajanın merkeze sunduğu işlemler. Adlar ve dönüş biçimleri
// merkezdeki src/lib/agent/ops.ts ile aynı; native ajan bunların bir alt
// kümesini sunar ve hangilerini sunduğunu `agent.hello` içinde
// `capabilities.ops` ile bildirir (merkez olmayanı "desteklenmiyor" gösterir).
package ops

import (
	"context"
	"os"
	"sort"
	"sync/atomic"
	"time"

	"github.com/coraspirin/servermanagementpanel/agent/internal/docker"
	"github.com/coraspirin/servermanagementpanel/agent/internal/hostinfo"
	"github.com/coraspirin/servermanagementpanel/agent/internal/policy"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
	"github.com/coraspirin/servermanagementpanel/agent/internal/update"
)

// CallFunc — değer döndüren op.
type CallFunc func(ctx context.Context, req *protocol.RpcRequest) (any, error)

// StreamFunc — akış op'u; her `emit` bir NDJSON veri çerçevesi olur.
type StreamFunc func(ctx context.Context, req *protocol.RpcRequest, emit func(any) error) error

// Op — ikisinden biri dolu.
type Op struct {
	Call   CallFunc
	Stream StreamFunc
}

// Registry — ad → op.
type Registry struct {
	ops map[string]Op
}

func (r *Registry) Get(name string) (Op, bool) {
	op, ok := r.ops[name]
	return op, ok
}

// Register — op ekler (sonraki adımların op grupları ve testler için).
func Register(r *Registry, name string, op Op) {
	r.ops[name] = op
}

// Names — sıralı op adları (hello'da bildirilir).
func (r *Registry) Names() []string {
	names := make([]string, 0, len(r.ops))
	for name := range r.ops {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Agent — op'ların paylaştığı durum.
type Agent struct {
	Version    string
	Roots      hostinfo.Roots
	Sampler    *hostinfo.Sampler
	ReportsDir string
	// Docker — nil ise Docker op'ları kaydedilmez.
	Docker *docker.Client
	// Policy — helper eylemleri bunun üzerinden karar verir; hello'da açık
	// eylemler bildirilir.
	Policy *policy.Store
	// Protected — dosya işlemlerinin asla dokunmadığı ajan yolları (host).
	Protected []string
	// Updater — kendini güncelleme (nil ise agent.update kaydedilmez).
	Updater *update.Updater
	Now     func() time.Time

	registry *Registry
	execIdle atomic.Int64 // ns; terminal boşta kapanma süresi
}

// Hello — merkezdeki AgentHello. `native` ve `ops` alanları protokole
// EKLEME (AGENT_PROTOCOL değişmez); eski merkez bunları yok sayar.
type Hello struct {
	Protocol     int          `json:"protocol"`
	Version      string       `json:"version"`
	Hostname     string       `json:"hostname"`
	OsName       *string      `json:"osName"`
	Time         int64        `json:"time"`
	Capabilities Capabilities `json:"capabilities"`
}

type Capabilities struct {
	Docker    bool `json:"docker"`
	Helper    bool `json:"helper"`
	HostRoot  bool `json:"hostRoot"`
	Reports   bool `json:"reports"`
	DockerAPI bool `json:"dockerApi"`
	// DockerRPC — `docker.list` vb. sağlayıcı RPC'si; native ajanda YOK (K2).
	DockerRPC bool     `json:"dockerRpc"`
	Native    bool     `json:"native"`
	Ops       []string `json:"ops"`
	// HelperActions — politikada açık helper eylemleri (desenliler dahil).
	HelperActions []string `json:"helperActions"`
}

// New — çekirdek op'larla kayıt. Sonraki adımlar (docker tüneli, dosyalar,
// helper eylemleri) buraya eklenir.
func New(a *Agent) *Registry {
	if a.Now == nil {
		a.Now = time.Now
	}
	r := &Registry{ops: map[string]Op{}}
	a.registry = r

	r.ops["agent.hello"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		return a.Hello(), nil
	}}
	r.ops["system.info"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		return a.Roots.Info(), nil
	}}
	r.ops["metrics.sample"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		return a.Sampler.Sample(hostinfo.MetricSettingsFrom(req.Settings)), nil
	}}
	r.ops["hardware.report"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		return a.Roots.Hardware(a.ReportsDir, req.Settings), nil
	}}
	if a.Docker != nil {
		registerDocker(r, a)
	}
	registerFiles(r, a)
	registerHelper(r, a)
	if a.Updater != nil {
		r.ops["agent.update"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
			if err := a.Updater.Start(stringArg(req.Args, 0)); err != nil {
				return nil, err
			}
			return protocol.Undefined{}, nil
		}}
		r.ops["agent.updateStatus"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
			return a.Updater.Status(), nil
		}}
	}
	return r
}

// Hello — kayıt yanıtında da kullanılır.
func (a *Agent) Hello() Hello {
	_, reportsErr := os.Stat(a.ReportsDir)
	_, rootErr := os.Stat(a.Roots.Root)
	dockerOK := a.Docker != nil && a.Docker.Available()
	return Hello{
		Protocol: protocol.Version,
		Version:  a.Version,
		Hostname: a.Roots.Hostname(),
		OsName:   a.Roots.OsName(),
		Time:     a.Now().Unix(),
		Capabilities: Capabilities{
			Docker:    dockerOK,
			Helper:    true,
			HostRoot:  rootErr == nil,
			Reports:   reportsErr == nil,
			DockerAPI: dockerOK,
			DockerRPC: false,
			Native:    true,
			Ops:       a.registry.Names(),

			HelperActions: a.HelperActions(),
		},
	}
}
