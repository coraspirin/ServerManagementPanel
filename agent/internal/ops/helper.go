package ops

import (
	"context"
	"log"
	"sort"

	"github.com/coraspirin/servermanagementpanel/agent/internal/helper"
	"github.com/coraspirin/servermanagementpanel/agent/internal/i18n"
	"github.com/coraspirin/servermanagementpanel/agent/internal/protocol"
)

// helper.call — host-helper eylemleri ajanın içinde (K4). Argümanlar Node
// ajanla aynı: [eylem, argümanlar, {username,userId}, zaman aşımı ms, istek
// kimliği]. İzin: policy.conf (`allow helper.<eylem> [desen]`) + profil.

// helperDecision — o anki politikaya göre; politika okunamıyorsa kapalı.
func (a *Agent) helperDecision(action, subject string) (bool, string) {
	if a.Policy == nil {
		return false, "action"
	}
	current, err := a.Policy.Current()
	if err != nil {
		return false, "action"
	}
	return current.Helper(action, subject)
}

// HelperActions — politikada açık eylemler (hello'da bildirilir).
func (a *Agent) HelperActions() []string {
	all := make([]string, 0, len(helper.Actions))
	for name := range helper.Actions {
		if helper.RemoteAllowed(name) {
			all = append(all, name)
		}
	}
	sort.Strings(all)
	if a.Policy == nil {
		return []string{}
	}
	current, err := a.Policy.Current()
	if err != nil {
		return []string{}
	}
	out := current.HelperActions(all)
	if out == nil {
		out = []string{}
	}
	return out
}

func registerHelper(r *Registry, a *Agent) {
	r.ops["helper.call"] = Op{Call: func(ctx context.Context, req *protocol.RpcRequest) (any, error) {
		action := stringArg(req.Args, 0)
		if !helper.RemoteAllowed(action) {
			return nil, protocol.Errorf("", "%s", i18n.T(i18n.Locale(req.Settings), "hosts.errors.unsupported", nil))
		}
		args, _ := argMap(req.Args, 1)
		actorMap, _ := argMap(req.Args, 2)
		actor := stringOf(actorMap["username"])
		if actor == "" {
			actor = "?"
		}
		return helper.Run(ctx, action, helper.Args(args), actor, a.helperDecision, func(format string, values ...any) {
			log.Printf("[helper] "+format, values...)
		}), nil
	}}
}
