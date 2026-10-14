package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

// JSON'un taşıyamadığı değerler etiketlenerek taşınır (merkezdeki
// encodeValue/decodeValue ile aynı):
//
//	Buffer     ↔ {"$t":"buf","v":"<base64>"}  → Bytes
//	Date       ↔ {"$t":"date","v":"<ISO>"}    → Date
//	undefined  ↔ {"$t":"undef"}               → Undefined
//
// Nesne alanındaki undefined JS'te yazılmaz; burada da Encode o alanı düşürür.

// Bytes — kabloda {"$t":"buf"}.
type Bytes []byte

func (b Bytes) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string{"$t": "buf", "v": base64.StdEncoding.EncodeToString(b)})
}

// Date — kabloda {"$t":"date"}; JS Date.toISOString biçimi (milisaniyeli, Z).
type Date time.Time

const isoLayout = "2006-01-02T15:04:05.000Z"

func (d Date) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string{"$t": "date", "v": time.Time(d).UTC().Format(isoLayout)})
}

// Undefined — kabloda {"$t":"undef"} (dizide ve dönüş değerinde anlamlı).
type Undefined struct{}

func (Undefined) MarshalJSON() ([]byte, error) { return []byte(`{"$t":"undef"}`), nil }

// Decode — kablodaki metni Go değerine çevirir: nesneler map[string]any,
// diziler []any, sayılar float64; etiketliler Bytes / Date / Undefined.
func Decode(text []byte) (any, error) {
	var raw any
	decoder := json.NewDecoder(bytes.NewReader(text))
	if err := decoder.Decode(&raw); err != nil {
		return nil, err
	}
	if decoder.More() {
		return nil, fmt.Errorf("fazladan veri")
	}
	return revive(raw)
}

func revive(value any) (any, error) {
	switch v := value.(type) {
	case []any:
		for i := range v {
			r, err := revive(v[i])
			if err != nil {
				return nil, err
			}
			v[i] = r
		}
		return v, nil
	case map[string]any:
		if tag, ok := v["$t"].(string); ok {
			switch tag {
			case "buf":
				s, _ := v["v"].(string)
				data, err := base64.StdEncoding.DecodeString(s)
				if err != nil {
					return nil, err
				}
				return Bytes(data), nil
			case "date":
				s, _ := v["v"].(string)
				t, err := time.Parse(time.RFC3339Nano, s)
				if err != nil {
					return nil, err
				}
				return Date(t), nil
			case "undef":
				return Undefined{}, nil
			}
		}
		for key, inner := range v {
			r, err := revive(inner)
			if err != nil {
				return nil, err
			}
			v[key] = r
		}
		return v, nil
	default:
		return v, nil
	}
}

// Encode — Go değerini kabloya yazar. Kök undefined/nil ayrımı: nil "null"
// olur; dönüş değeri olmayan op'lar Undefined{} döndürür.
func Encode(value any) ([]byte, error) {
	return marshal(value)
}

// dropUndefinedFields — map içindeki Undefined alanları siler (JS davranışı),
// dizidekiler kalır. Yalnız genel ağaçlar (map/slice) dolaşılır; yapılar
// alanlarını `omitempty` ile kendileri yönetir.
func dropUndefinedFields(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, inner := range v {
			if _, undef := inner.(Undefined); undef {
				continue
			}
			out[key] = dropUndefinedFields(inner)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, inner := range v {
			out[i] = dropUndefinedFields(inner)
		}
		return out
	default:
		return v
	}
}

// --- Mesajlar ----------------------------------------------------------------

// RpcRequest — /api/agent/rpc ve /api/agent/stream gövdesi.
type RpcRequest struct {
	Op       string
	Args     []any
	Settings map[string]any
}

// ParseRpc — gövdeyi doğrular; op metin, args dizi olmalı.
func ParseRpc(body []byte) (*RpcRequest, bool) {
	value, err := Decode(body)
	if err != nil {
		return nil, false
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	op, ok := m["op"].(string)
	if !ok {
		return nil, false
	}
	args, ok := m["args"].([]any)
	if !ok {
		return nil, false
	}
	settings, _ := m["settings"].(map[string]any)
	if settings == nil {
		settings = map[string]any{}
	}
	return &RpcRequest{Op: op, Args: args, Settings: settings}, true
}

// RpcError — merkezde `{ message, code? }`.
type RpcError struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

func (e *RpcError) Error() string { return e.Message }

// Errorf — kodlu hata.
func Errorf(code, format string, args ...any) *RpcError {
	return &RpcError{Message: fmt.Sprintf(format, args...), Code: code}
}

// marshal — JS JSON.stringify gibi (`<>&` kaçırılmaz), sonda satır sonu yok.
func marshal(value any) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(dropUndefinedFields(value)); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func asRpcError(err error) *RpcError {
	if rpcErr, ok := err.(*RpcError); ok {
		return rpcErr
	}
	return &RpcError{Message: err.Error()}
}

// Reply — `{ok:true,value}` / `{ok:false,error}`; alan sırası Node ajanla
// aynı (kablo birebir). Undefined{} değer alanı düşürür (`{"ok":true}`),
// nil "null" yazılır.
type Reply struct {
	Ok    bool
	Value any
	Err   *RpcError
}

func (r Reply) MarshalJSON() ([]byte, error) {
	if !r.Ok {
		inner, err := marshal(r.Err)
		if err != nil {
			return nil, err
		}
		return append(append([]byte(`{"ok":false,"error":`), inner...), '}'), nil
	}
	if _, undef := r.Value.(Undefined); undef {
		return []byte(`{"ok":true}`), nil
	}
	inner, err := marshal(r.Value)
	if err != nil {
		return nil, err
	}
	return append(append([]byte(`{"ok":true,"value":`), inner...), '}'), nil
}

func OkReply(value any) Reply  { return Reply{Ok: true, Value: value} }
func ErrReply(err error) Reply { return Reply{Err: asRpcError(err)} }

// Frame — akış çerçevesi (NDJSON, satır başına bir tane):
// {"t":"d","d":…} | {"t":"end"} | {"t":"err","e":{…}}.
type Frame struct {
	T string
	D any
	E *RpcError
}

func (f Frame) MarshalJSON() ([]byte, error) {
	switch f.T {
	case "d":
		inner, err := marshal(f.D)
		if err != nil {
			return nil, err
		}
		return append(append([]byte(`{"t":"d","d":`), inner...), '}'), nil
	case "err":
		inner, err := marshal(f.E)
		if err != nil {
			return nil, err
		}
		return append(append([]byte(`{"t":"err","e":`), inner...), '}'), nil
	default:
		return []byte(`{"t":"end"}`), nil
	}
}

func DataFrame(d any) Frame    { return Frame{T: "d", D: d} }
func EndFrame() Frame          { return Frame{T: "end"} }
func ErrFrame(err error) Frame { return Frame{T: "err", E: asRpcError(err)} }
