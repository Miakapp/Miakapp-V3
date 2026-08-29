package protocol

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

func FuzzDecodeFrame(f *testing.F) {
	data, err := os.ReadFile("../fixtures/v1/frames.json")
	if err != nil {
		f.Fatal(err)
	}
	var fixtures fixtureFile
	if err := json.Unmarshal(data, &fixtures); err != nil {
		f.Fatal(err)
	}
	for _, fixture := range fixtures.Valid {
		wire, err := hex.DecodeString(fixture.Hex)
		if err == nil {
			f.Add(wire)
		}
	}
	for _, fixture := range fixtures.InvalidWire {
		wire, err := hex.DecodeString(fixture.Hex)
		if err == nil {
			f.Add(wire)
		}
	}

	f.Fuzz(func(t *testing.T, input []byte) {
		frame, err := DecodeFrame(input)
		if err != nil {
			var protocolErr *ProtocolError
			if !errors.As(err, &protocolErr) {
				t.Fatalf("decoder exposed non-protocol error %T: %v", err, err)
			}
			return
		}
		encoded, err := EncodeFrame(frame)
		if err != nil {
			t.Fatalf("accepted frame cannot be re-encoded: %v", err)
		}
		if !reflect.DeepEqual(encoded, input) {
			t.Fatalf("accepted frame is not canonical\ninput: %x\noutput: %x", input, encoded)
		}
	})
}
