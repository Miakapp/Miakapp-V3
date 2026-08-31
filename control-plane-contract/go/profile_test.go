package controlplane

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const fixturePath = "../fixtures/v1/access-tokens.json"

func loadTestFixture(t *testing.T) *Fixture {
	t.Helper()
	fixture, err := LoadFixture(fixturePath)
	if err != nil {
		t.Fatalf("LoadFixture() error = %v", err)
	}
	return fixture
}

func TestSharedTokenVectors(t *testing.T) {
	fixture := loadTestFixture(t)
	for _, vector := range fixture.Vectors {
		vector := vector
		t.Run(vector.ID, func(t *testing.T) {
			identity, err := VerifyVector(vector, fixture)
			if !vector.Valid {
				if got := VerificationCode(err); got != vector.Error {
					t.Fatalf("VerificationCode() = %q, want %q (error %v)", got, vector.Error, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("VerifyVector() error = %v", err)
			}
			if len(vector.Expected) == 0 {
				t.Fatal("valid vector lacks expected evidence")
			}
			if vector.Kind == "firebase" {
				var expected FirebaseIdentity
				if err = decodeJSON(vector.Expected, &expected); err != nil {
					t.Fatalf("decode expected Firebase identity: %v", err)
				}
				if !reflect.DeepEqual(identity, &expected) {
					t.Fatalf("identity = %#v, want %#v", identity, &expected)
				}
				return
			}
			var expected AccessIdentity
			if err = decodeJSON(vector.Expected, &expected); err != nil {
				t.Fatalf("decode expected access identity: %v", err)
			}
			if !reflect.DeepEqual(identity, &expected) {
				t.Fatalf("identity = %#v, want %#v", identity, &expected)
			}
		})
	}
}

func TestAccessTokenCannotCrossResourceProfiles(t *testing.T) {
	fixture := loadTestFixture(t)
	var coordinator TokenVector
	for _, vector := range fixture.Vectors {
		if vector.ID == "valid_coordinator" {
			coordinator = vector
			break
		}
	}
	if coordinator.ID == "" {
		t.Fatal("valid_coordinator fixture is missing")
	}
	_, err := VerifyMiakappAccessToken(
		coordinator.Token,
		fixture,
		"push",
		fixture.KeySets[coordinator.KeySet].Keys,
	)
	if got := VerificationCode(err); got != InvalidAudience {
		t.Fatalf("cross-resource VerificationCode() = %q, want %q", got, InvalidAudience)
	}
}

func TestHomeKeyEvidence(t *testing.T) {
	fixture := loadTestFixture(t)
	keyID, secret, err := ParseHomeKey(fixture.HomeKey.Value)
	if err != nil {
		t.Fatalf("ParseHomeKey() error = %v", err)
	}
	if keyID != fixture.HomeKey.KeyID || len(secret) != fixture.HomeKey.SecretBytes {
		t.Fatalf("parsed Home Key = (%q, %d bytes), want (%q, %d bytes)", keyID, len(secret), fixture.HomeKey.KeyID, fixture.HomeKey.SecretBytes)
	}
	pepper, err := base64.RawURLEncoding.DecodeString(fixture.HomeKey.PepperBase64URL)
	if err != nil {
		t.Fatalf("decode pepper: %v", err)
	}
	verifier, err := DeriveHomeKeyVerifier(fixture.HomeKey.Value, pepper)
	if err != nil {
		t.Fatalf("DeriveHomeKeyVerifier() error = %v", err)
	}
	if verifier != fixture.HomeKey.VerifierBase64URL {
		t.Fatalf("verifier = %q, want fixture evidence", verifier)
	}
	for _, malformed := range fixture.HomeKey.Malformed {
		if _, _, err = ParseHomeKey(malformed); err == nil {
			t.Fatalf("ParseHomeKey() accepted malformed value %q", malformed)
		} else if malformed != "" && strings.Contains(err.Error(), malformed) {
			t.Fatal("Home Key error echoed the rejected credential")
		}
	}
}

func TestStrictJSONRejectsAmbiguousOrUnboundedInputs(t *testing.T) {
	uniqueEntries := make([]string, 257)
	for index := range uniqueEntries {
		uniqueEntries[index] = fmt.Sprintf("%q:0", fmt.Sprintf("k%d", index))
	}
	tests := map[string][]byte{
		"duplicate key":    []byte(`{"alg":"EdDSA","alg":"none"}`),
		"prototype key":    []byte(`{"__proto__":{}}`),
		"trailing token":   []byte(`{} {}`),
		"invalid UTF-8":    {0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d},
		"high surrogate":   []byte(`{"value":"\ud800"}`),
		"low surrogate":    []byte(`{"value":"\udc00"}`),
		"oversized object": []byte("{" + strings.Join(uniqueEntries, ",") + "}"),
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			if err := validateJSON(input); err == nil {
				t.Fatal("validateJSON() accepted hostile input")
			}
		})
	}
}

func TestTokenJSONUsesNormativeCrossLanguageLimits(t *testing.T) {
	oversizedString := []byte(`{"padding":"` + strings.Repeat("x", 4_097) + `"}`)
	if err := validateJSONWithLimits(oversizedString, tokenJSONLimits); err == nil {
		t.Fatal("token JSON accepted a 4097-byte string")
	}
	values := []byte(`{"padding":[` + strings.Repeat("0,", 2_047) + `0]}`)
	if err := validateJSONWithLimits(values, tokenJSONLimits); err == nil {
		t.Fatal("token JSON accepted more than 2048 values")
	}
}

func TestStrictJSONAcceptsPairedAndEscapedSurrogates(t *testing.T) {
	for _, input := range [][]byte{
		[]byte(`{"value":"\ud83d\ude00"}`),
		[]byte(`{"value":"\\ud800"}`),
	} {
		if err := validateJSON(input); err != nil {
			t.Fatalf("validateJSON() rejected valid input %s: %v", input, err)
		}
	}
}

func TestVerifierRejectsContradictoryJWKUsage(t *testing.T) {
	fixture := loadTestFixture(t)
	var coordinator TokenVector
	for _, vector := range fixture.Vectors {
		if vector.ID == "valid_coordinator" {
			coordinator = vector
			break
		}
	}
	keys := append([]PublicJWK(nil), fixture.KeySets[coordinator.KeySet].Keys...)
	keys[0].Use = "enc"
	_, err := VerifyMiakappAccessToken(coordinator.Token, fixture, "coordinator", keys)
	if got := VerificationCode(err); got != InvalidHeader {
		t.Fatalf("contradictory JWK VerificationCode() = %q, want %q", got, InvalidHeader)
	}
}

func TestLoadFixtureRejectsOversizedAndDuplicateDocuments(t *testing.T) {
	temporary := t.TempDir()
	oversized := filepath.Join(temporary, "oversized.json")
	if err := os.WriteFile(oversized, bytes.Repeat([]byte{' '}, MaxFixtureBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFixture(oversized); err == nil {
		t.Fatal("LoadFixture() accepted an oversized file")
	}

	duplicate := filepath.Join(temporary, "duplicate.json")
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	mutated := strings.Replace(string(data), `"schema":`, `"schema":"shadow","schema":`, 1)
	if err = os.WriteFile(duplicate, []byte(mutated), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadFixture(duplicate); err == nil || !strings.Contains(err.Error(), "duplicate JSON key") {
		t.Fatalf("LoadFixture() duplicate error = %v", err)
	}
}

func TestVerificationCodeDoesNotClassifyOrdinaryErrors(t *testing.T) {
	if code := VerificationCode(errors.New("synthetic failure")); code != "" {
		t.Fatalf("VerificationCode() = %q, want empty", code)
	}

	encoded, err := json.Marshal(&VerificationError{Code: InvalidClaims})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "credential") {
		t.Fatal("verification errors must not serialize credential material")
	}
}
