package protocol

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"sort"
	"testing"
)

type validFixture struct {
	Name    string `json:"name"`
	Opcode  byte   `json:"opcode"`
	Payload []any  `json:"payload"`
	Hex     string `json:"hex"`
}

type invalidWireFixture struct {
	Name  string    `json:"name"`
	Hex   string    `json:"hex"`
	Error ErrorKind `json:"error"`
}

type invalidSemanticFixture struct {
	Name    string    `json:"name"`
	Opcode  byte      `json:"opcode"`
	Payload []any     `json:"payload"`
	Error   ErrorKind `json:"error"`
}

type fixtureFile struct {
	Valid           []validFixture           `json:"valid"`
	InvalidWire     []invalidWireFixture     `json:"invalidWire"`
	InvalidSemantic []invalidSemanticFixture `json:"invalidSemantic"`
}

func loadFixtures(t *testing.T) fixtureFile {
	t.Helper()
	data, err := os.ReadFile("../fixtures/v1/frames.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures fixtureFile
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	return fixtures
}

func materializeFixture(t *testing.T, value any) any {
	t.Helper()
	switch typed := value.(type) {
	case []any:
		output := make([]any, len(typed))
		for index, child := range typed {
			output[index] = materializeFixture(t, child)
		}
		return output
	case map[string]any:
		if len(typed) == 1 {
			if encoded, ok := typed["$binary"].(string); ok {
				decoded, err := hex.DecodeString(encoded)
				if err != nil {
					t.Fatal(err)
				}
				return decoded
			}
		}
		output := make(map[string]any, len(typed))
		for key, child := range typed {
			output[key] = materializeFixture(t, child)
		}
		return output
	default:
		return value
	}
}

func normalizeFixture(value any) any {
	switch typed := value.(type) {
	case []byte:
		return map[string]any{"$binary": hex.EncodeToString(typed)}
	case []any:
		output := make([]any, len(typed))
		for index, child := range typed {
			output[index] = normalizeFixture(child)
		}
		return output
	case map[string]any:
		output := make(map[string]any, len(typed))
		for key, child := range typed {
			output[key] = normalizeFixture(child)
		}
		return output
	case int:
		return float64(typed)
	case int8:
		return float64(typed)
	case int16:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case uint:
		return float64(typed)
	case uint8:
		return float64(typed)
	case uint16:
		return float64(typed)
	case uint32:
		return float64(typed)
	case uint64:
		return float64(typed)
	default:
		return value
	}
}

func requireProtocolError(t *testing.T, err error, expected ErrorKind) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected protocol error %q", expected)
	}
	var protocolErr *ProtocolError
	if !errors.As(err, &protocolErr) {
		t.Fatalf("expected ProtocolError, got %T: %v", err, err)
	}
	if protocolErr.Kind != expected {
		t.Fatalf("expected error %q, got %q: %v", expected, protocolErr.Kind, protocolErr)
	}
}

func TestSharedFixtures(t *testing.T) {
	fixtures := loadFixtures(t)

	for _, fixture := range fixtures.Valid {
		fixture := fixture
		t.Run("encode_"+fixture.Name, func(t *testing.T) {
			payload := materializeFixture(t, fixture.Payload).([]any)
			encoded, err := EncodeFrame(Frame{Opcode: fixture.Opcode, Payload: payload})
			if err != nil {
				t.Fatal(err)
			}
			if actual := hex.EncodeToString(encoded); actual != fixture.Hex {
				t.Fatalf("wire mismatch\nwant: %s\n got: %s", fixture.Hex, actual)
			}
		})

		t.Run("decode_"+fixture.Name, func(t *testing.T) {
			wire, err := hex.DecodeString(fixture.Hex)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := DecodeFrame(wire)
			if err != nil {
				t.Fatal(err)
			}
			if decoded.Opcode != fixture.Opcode {
				t.Fatalf("expected opcode %x, got %x", fixture.Opcode, decoded.Opcode)
			}
			if !reflect.DeepEqual(normalizeFixture(decoded.Payload), fixture.Payload) {
				t.Fatalf("semantic mismatch\nwant: %#v\n got: %#v", fixture.Payload, normalizeFixture(decoded.Payload))
			}
		})
	}

	for _, fixture := range fixtures.InvalidWire {
		fixture := fixture
		t.Run("reject_wire_"+fixture.Name, func(t *testing.T) {
			wire, err := hex.DecodeString(fixture.Hex)
			if err != nil {
				t.Fatal(err)
			}
			_, err = DecodeFrame(wire)
			requireProtocolError(t, err, fixture.Error)
		})
	}

	for _, fixture := range fixtures.InvalidSemantic {
		fixture := fixture
		t.Run("reject_semantic_"+fixture.Name, func(t *testing.T) {
			payload := materializeFixture(t, fixture.Payload).([]any)
			_, err := EncodeFrame(Frame{Opcode: fixture.Opcode, Payload: payload})
			requireProtocolError(t, err, fixture.Error)
		})
	}
}

func TestFixtureCoverage(t *testing.T) {
	fixtures := loadFixtures(t)
	covered := make([]int, 0)
	seen := make(map[byte]struct{})
	for _, fixture := range fixtures.Valid {
		if fixture.Opcode < 0x80 {
			seen[fixture.Opcode] = struct{}{}
		}
	}
	for opcode := range seen {
		covered = append(covered, int(opcode))
	}
	sort.Ints(covered)

	expected := make([]int, 0)
	for opcode := 0; opcode <= 0xff; opcode++ {
		if knownCoreOpcode(byte(opcode)) {
			expected = append(expected, opcode)
		}
	}
	if !reflect.DeepEqual(covered, expected) {
		t.Fatalf("fixture opcode coverage mismatch\nwant: %v\n got: %v", expected, covered)
	}
}

func TestValueProfile(t *testing.T) {
	value := map[string]any{
		"array":  []any{nil, true, false, float64(-33), float64(128), 1.25},
		"binary": []byte{0, 1, 254, 255},
		"object": map[string]any{"nested": "été 😀"},
	}
	encoded, err := EncodeFrame(Frame{Opcode: 0x80, Payload: []any{value}})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeFrame(encoded)
	if err != nil {
		t.Fatal(err)
	}
	reencoded, err := EncodeFrame(decoded)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(encoded, reencoded) {
		t.Fatal("accepted bytes are not canonically reproducible")
	}
}

func TestDecodedIntegersAreNormalized(t *testing.T) {
	wire, err := hex.DecodeString("8192d3ffe0000000000001cf001fffffffffffff")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeFrame(wire)
	if err != nil {
		t.Fatal(err)
	}
	for index, value := range decoded.Payload {
		if _, ok := value.(int64); !ok {
			t.Fatalf("payload[%d] should be int64, got %T", index, value)
		}
	}
}

func TestUnsupportedValues(t *testing.T) {
	cases := []any{
		math.Copysign(0, -1),
		math.NaN(),
		math.Inf(1),
		uint64(maxSafeInteger) + 1,
		struct{}{},
		map[string]any{"__proto__": "blocked"},
	}
	for _, value := range cases {
		_, err := EncodeFrame(Frame{Opcode: 0x80, Payload: []any{value}})
		requireProtocolError(t, err, ErrInvalidValue)
	}
}

func TestResourceLimits(t *testing.T) {
	_, err := DecodeFrame(make([]byte, MaxFrameBytes+1))
	requireProtocolError(t, err, ErrFrameTooLarge)

	accepted := any(nil)
	for depth := 1; depth < MaxDepth; depth++ {
		accepted = []any{accepted}
	}
	if _, err = EncodeFrame(Frame{Opcode: 0x80, Payload: accepted.([]any)}); err != nil {
		t.Fatalf("maximum nesting depth should be accepted: %v", err)
	}

	value := any(nil)
	for depth := 0; depth < MaxDepth; depth++ {
		value = []any{value}
	}
	_, err = EncodeFrame(Frame{Opcode: 0x80, Payload: value.([]any)})
	requireProtocolError(t, err, ErrLimit)

	_, err = EncodeFrame(Frame{Opcode: 0x80, Payload: []any{stringsOfLength(MaxStringBytes + 1)}})
	requireProtocolError(t, err, ErrLimit)

	_, err = EncodeFrame(Frame{Opcode: 0x80, Payload: []any{make([]byte, MaxBinaryBytes+1)}})
	requireProtocolError(t, err, ErrLimit)

	_, err = EncodeFrame(Frame{Opcode: 0x80, Payload: []any{make([]any, MaxArrayItems+1)}})
	requireProtocolError(t, err, ErrLimit)

	groups := make([]any, 5)
	for index := range groups {
		groups[index] = make([]any, MaxArrayItems)
	}
	_, err = EncodeFrame(Frame{Opcode: 0x80, Payload: groups})
	requireProtocolError(t, err, ErrLimit)

	largeStrings := make([]any, MaxArrayItems)
	for index := range largeStrings {
		largeStrings[index] = stringsOfLength(64)
	}
	_, err = EncodeFrame(Frame{Opcode: 0x80, Payload: []any{largeStrings}})
	requireProtocolError(t, err, ErrFrameTooLarge)
}

func stringsOfLength(length int) string {
	value := make([]byte, length)
	for index := range value {
		value[index] = 'a'
	}
	return string(value)
}
