package controlplane

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"reflect"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	AccessVectorsSchema = "miakapp.control-plane-access-token-vectors/1"
	MaxFixtureBytes     = 262_144
	MaxTokenBytes       = 8_192
)

var (
	homeKeyPattern = regexp.MustCompile(`^mhk1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$`)
	base64URL      = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	asciiID        = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	forbiddenKeys  = map[string]struct{}{
		"__proto__":   {},
		"prototype":   {},
		"constructor": {},
	}
)

type PublicJWK struct {
	KTY string `json:"kty"`
	KID string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	CRV string `json:"crv,omitempty"`
	X   string `json:"x,omitempty"`
	N   string `json:"n,omitempty"`
	E   string `json:"e,omitempty"`
}

type KeySet struct {
	Keys []PublicJWK `json:"keys"`
}

type Deployment struct {
	Issuer                    string `json:"issuer"`
	JWKSURI                   string `json:"jwks_uri"`
	ExchangeEndpoint          string `json:"exchange_endpoint"`
	UserRelayExchangeEndpoint string `json:"user_relay_exchange_endpoint"`
	PushAudience              string `json:"push_audience"`
	ComponentsAudience        string `json:"components_audience"`
	RelayAudience             string `json:"relay_audience"`
}

type FirebaseProfile struct {
	ProjectID  string      `json:"project_id"`
	Issuer     string      `json:"issuer"`
	PublicKeys []PublicJWK `json:"public_keys"`
}

type HomeKeyFixture struct {
	Value             string   `json:"value"`
	KeyID             string   `json:"key_id"`
	SecretBytes       int      `json:"secret_bytes"`
	PepperBase64URL   string   `json:"pepper_base64url"`
	VerifierBase64URL string   `json:"verifier_base64url"`
	Malformed         []string `json:"malformed"`
}

type TokenVector struct {
	ID               string          `json:"id"`
	Kind             string          `json:"kind"`
	Profile          string          `json:"profile"`
	KeySet           string          `json:"key_set"`
	VerificationTime int64           `json:"verification_time"`
	Token            string          `json:"token"`
	Valid            bool            `json:"valid"`
	Error            string          `json:"error,omitempty"`
	Expected         json.RawMessage `json:"expected,omitempty"`
}

type RotationTransition struct {
	Phase      string `json:"phase"`
	At         int64  `json:"at"`
	KeySet     string `json:"key_set"`
	SigningKID string `json:"signing_kid"`
}

type RotationProfile struct {
	RetiringKID          string               `json:"retiring_kid"`
	RetiringLastIssuedAt int64                `json:"retiring_last_issued_at"`
	Transitions          []RotationTransition `json:"transitions"`
}

type Fixture struct {
	Schema         string                     `json:"schema"`
	FixtureVersion int                        `json:"fixture_version"`
	Now            int64                      `json:"now"`
	Deployment     Deployment                 `json:"deployment"`
	Firebase       FirebaseProfile            `json:"firebase"`
	HomeKey        HomeKeyFixture             `json:"home_key"`
	KeySets        map[string]KeySet          `json:"key_sets"`
	Rotation       RotationProfile            `json:"rotation"`
	Vectors        []TokenVector              `json:"vectors"`
	Provenance     map[string]any             `json:"provenance"`
	PrivateKeys    map[string]json.RawMessage `json:"test_only_private_keys"`
}

type jsonBudget struct {
	values int
}

type jsonLimits struct {
	maximumDepth         int
	maximumValues        int
	maximumStringBytes   int
	maximumArrayItems    int
	maximumObjectEntries int
}

var (
	fixtureJSONLimits = jsonLimits{16, 8_192, 16_384, 256, 256}
	tokenJSONLimits   = jsonLimits{16, 2_048, 4_096, 256, 256}
	requiredVectorIDs = []string{
		"valid_coordinator", "valid_cli", "valid_push", "valid_components",
		"valid_user_access", "valid_user_access_without_email", "user_wrong_audience",
		"user_invalid_home", "user_invalid_uid", "user_wrong_role", "user_missing_role",
		"user_wrong_scope", "user_multiple_scopes", "user_forbidden_client_id",
		"user_forbidden_coordinator", "user_invalid_verified_email", "user_overlong_ttl",
		"user_future_iat", "user_bad_signature",
		"valid_retiring_during_overlap", "valid_future_after_rotation",
		"unknown_future_before_rotation", "retiring_removed_after_overlap",
		"wrong_issuer", "wrong_audience", "audience_array", "expired",
		"overlong_ttl", "future_iat", "future_iat_full_ttl", "multiple_scopes",
		"role_scope_mismatch", "missing_coordinator", "overlong_coordinator",
		"wrong_type", "algorithm_confusion", "algorithm_none", "unknown_claim",
		"unsafe_integer", "integer_decimal_lexeme", "integer_exponent_lexeme",
		"duplicate_payload_key", "unpaired_surrogate", "bad_signature", "padded_segment",
		"valid_firebase_verified_email", "valid_firebase_unverified_email",
		"valid_firebase_without_email", "firebase_wrong_project", "firebase_wrong_issuer",
		"firebase_expired", "firebase_future_iat", "firebase_future_auth_time",
		"firebase_stale_authentication", "firebase_null_type",
		"firebase_oversized_json_string", "firebase_excessive_json_values",
		"valid_firebase_rs256_3072", "firebase_wrong_algorithm",
	}
)

func hexValue(value byte) (uint16, bool) {
	switch {
	case value >= '0' && value <= '9':
		return uint16(value - '0'), true
	case value >= 'a' && value <= 'f':
		return uint16(value-'a') + 10, true
	case value >= 'A' && value <= 'F':
		return uint16(value-'A') + 10, true
	default:
		return 0, false
	}
}

func decodeUnicodeEscape(data []byte, index int) (uint16, bool) {
	if index+4 > len(data) {
		return 0, false
	}
	var value uint16
	for offset := 0; offset < 4; offset++ {
		digit, ok := hexValue(data[index+offset])
		if !ok {
			return 0, false
		}
		value = value<<4 | digit
	}
	return value, true
}

func rejectUnpairedSurrogateEscapes(data []byte) error {
	inString := false
	for index := 0; index < len(data); index++ {
		switch data[index] {
		case '"':
			inString = !inString
		case '\\':
			if !inString || index+1 >= len(data) {
				continue
			}
			index++
			if data[index] != 'u' {
				continue
			}
			codePoint, ok := decodeUnicodeEscape(data, index+1)
			if !ok {
				continue
			}
			index += 4
			if codePoint >= 0xdc00 && codePoint <= 0xdfff {
				return errors.New("JSON string contains an unpaired Unicode surrogate")
			}
			if codePoint < 0xd800 || codePoint > 0xdbff {
				continue
			}
			if index+6 >= len(data) || data[index+1] != '\\' || data[index+2] != 'u' {
				return errors.New("JSON string contains an unpaired Unicode surrogate")
			}
			low, lowOK := decodeUnicodeEscape(data, index+3)
			if !lowOK || low < 0xdc00 || low > 0xdfff {
				return errors.New("JSON string contains an unpaired Unicode surrogate")
			}
			index += 6
		}
	}
	return nil
}

func scanJSONValue(decoder *json.Decoder, budget *jsonBudget, limits jsonLimits, depth int) error {
	if depth > limits.maximumDepth {
		return fmt.Errorf("JSON depth exceeds %d", limits.maximumDepth)
	}
	budget.values++
	if budget.values > limits.maximumValues {
		return fmt.Errorf("JSON values exceed %d", limits.maximumValues)
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			keys := make(map[string]struct{})
			for decoder.More() {
				keyToken, keyErr := decoder.Token()
				if keyErr != nil {
					return keyErr
				}
				key, ok := keyToken.(string)
				if !ok || !utf8.ValidString(key) || len(key) > limits.maximumStringBytes {
					return errors.New("invalid JSON object key")
				}
				if _, exists := keys[key]; exists {
					return fmt.Errorf("duplicate JSON key %q", key)
				}
				if _, forbidden := forbiddenKeys[key]; forbidden {
					return fmt.Errorf("forbidden JSON key %q", key)
				}
				if len(keys) >= limits.maximumObjectEntries {
					return fmt.Errorf("JSON object entries exceed %d", limits.maximumObjectEntries)
				}
				keys[key] = struct{}{}
				if err = scanJSONValue(decoder, budget, limits, depth+1); err != nil {
					return err
				}
			}
			closing, closeErr := decoder.Token()
			if closeErr != nil || closing != json.Delim('}') {
				return errors.New("invalid JSON object closing delimiter")
			}
		case '[':
			items := 0
			for decoder.More() {
				items++
				if items > limits.maximumArrayItems {
					return fmt.Errorf("JSON array items exceed %d", limits.maximumArrayItems)
				}
				if err = scanJSONValue(decoder, budget, limits, depth+1); err != nil {
					return err
				}
			}
			closing, closeErr := decoder.Token()
			if closeErr != nil || closing != json.Delim(']') {
				return errors.New("invalid JSON array closing delimiter")
			}
		default:
			return errors.New("invalid JSON delimiter")
		}
	case string:
		if !utf8.ValidString(value) || len(value) > limits.maximumStringBytes {
			return errors.New("invalid or oversized JSON string")
		}
	case json.Number:
		if _, err = value.Float64(); err != nil {
			return errors.New("invalid JSON number")
		}
	case bool, nil:
	default:
		return errors.New("invalid JSON token")
	}
	return nil
}

func validateJSONWithLimits(data []byte, limits jsonLimits) error {
	if !utf8.Valid(data) {
		return errors.New("JSON is not valid UTF-8")
	}
	if err := rejectUnpairedSurrogateEscapes(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := scanJSONValue(decoder, &jsonBudget{}, limits, 1); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("JSON has trailing token")
		}
		return err
	}
	return nil
}

func validateJSON(data []byte) error {
	return validateJSONWithLimits(data, fixtureJSONLimits)
}

func decodeJSON(data []byte, target any) error {
	if err := validateJSON(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func LoadFixture(path string) (*Fixture, error) {
	metadata, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !metadata.Mode().IsRegular() || metadata.Size() > MaxFixtureBytes {
		return nil, errors.New("fixture exceeds its file limit")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fixture Fixture
	if err = decodeJSON(data, &fixture); err != nil {
		return nil, err
	}
	if fixture.Schema != AccessVectorsSchema || fixture.FixtureVersion != 1 || fixture.Now <= 0 {
		return nil, errors.New("fixture schema is unsupported")
	}
	if fixture.Provenance["kind"] != "hand_authored_synthetic" || fixture.Provenance["contains_production_data"] != false {
		return nil, errors.New("fixture provenance is not synthetic")
	}
	for _, required := range []string{"initial", "prepublished", "rotated", "retired", "firebase"} {
		if _, exists := fixture.KeySets[required]; !exists {
			return nil, fmt.Errorf("fixture lacks key set %s", required)
		}
	}
	for name, keySet := range fixture.KeySets {
		if len(keySet.Keys) == 0 || len(keySet.Keys) > 16 {
			return nil, fmt.Errorf("key set %s has invalid cardinality", name)
		}
		seen := make(map[string]struct{})
		for _, key := range keySet.Keys {
			if !asciiID.MatchString(key.KID) {
				return nil, fmt.Errorf("key set %s has invalid kid", name)
			}
			switch key.KTY {
			case "OKP":
				decoded, decodeErr := decodeBase64URL(key.X, "Ed25519 x", 32)
				if decodeErr != nil || len(decoded) != 32 || key.CRV != "Ed25519" || key.Use != "sig" || key.Alg != "EdDSA" || key.N != "" || key.E != "" {
					return nil, fmt.Errorf("key set %s has invalid Ed25519 key", name)
				}
			case "RSA":
				modulus, modulusErr := decodeBase64URL(key.N, "RSA n", -1)
				exponent, exponentErr := decodeBase64URL(key.E, "RSA e", -1)
				modulusInteger := new(big.Int).SetBytes(modulus)
				exponentInteger := new(big.Int).SetBytes(exponent)
				if modulusErr != nil || exponentErr != nil || modulusInteger.BitLen() < 2_048 || modulusInteger.BitLen() > 4_096 || len(modulus) == 0 || modulus[0] == 0 || len(exponent) == 0 || len(exponent) > 4 || exponentInteger.Cmp(big.NewInt(3)) < 0 || exponentInteger.Bit(0) == 0 || key.Use != "sig" || key.Alg != "RS256" || key.CRV != "" || key.X != "" {
					return nil, fmt.Errorf("key set %s has invalid RSA key", name)
				}
			default:
				return nil, fmt.Errorf("key set %s has unsupported key type", name)
			}
			if name == "firebase" && key.KTY != "RSA" {
				return nil, errors.New("firebase contains a non-RSA ID-token key")
			}
			if name != "firebase" && key.KTY != "OKP" {
				return nil, fmt.Errorf("key set %s contains a non-Ed25519 access-token key", name)
			}
			if _, exists := seen[key.KID]; exists {
				return nil, fmt.Errorf("key set %s repeats kid", name)
			}
			seen[key.KID] = struct{}{}
		}
	}
	if !reflect.DeepEqual(fixture.Firebase.PublicKeys, fixture.KeySets["firebase"].Keys) {
		return nil, errors.New("Firebase public key sources disagree")
	}
	if err = validateRotationProfile(&fixture); err != nil {
		return nil, err
	}
	if len(fixture.Vectors) == 0 {
		return nil, errors.New("fixture has no token vectors")
	}
	seenVectors := make(map[string]struct{})
	for _, vector := range fixture.Vectors {
		validProfile := vector.Profile == "user" || vector.Profile == "coordinator" || vector.Profile == "cli" || vector.Profile == "push" || vector.Profile == "components"
		if vector.ID == "" || vector.VerificationTime <= 0 || len(vector.Token) > MaxTokenBytes || !validProfile || (vector.Kind != "miakapp" && vector.Kind != "firebase") || (vector.Kind == "firebase" && vector.Profile != "user") || ((vector.Kind == "firebase") != (vector.KeySet == "firebase")) {
			return nil, errors.New("fixture has invalid token vector")
		}
		expectedKeySet, keySetErr := expectedVectorKeySet(&fixture, vector)
		if keySetErr != nil {
			return nil, keySetErr
		}
		if vector.KeySet != expectedKeySet {
			return nil, fmt.Errorf("%s does not use its clock-derived key set", vector.ID)
		}
		if _, exists := seenVectors[vector.ID]; exists {
			return nil, errors.New("fixture repeats vector ID")
		}
		seenVectors[vector.ID] = struct{}{}
	}
	for _, required := range requiredVectorIDs {
		if _, exists := seenVectors[required]; !exists {
			return nil, fmt.Errorf("fixture lacks %s", required)
		}
	}
	if err = validateRequiredVectorEvidence(&fixture); err != nil {
		return nil, err
	}
	return &fixture, nil
}

func fixtureVector(fixture *Fixture, id string) (TokenVector, error) {
	for _, vector := range fixture.Vectors {
		if vector.ID == id {
			return vector, nil
		}
	}
	return TokenVector{}, fmt.Errorf("fixture lacks %s", id)
}

func decodedVectorObject(vector TokenVector, segmentIndex int) (map[string]any, error) {
	segments := strings.Split(vector.Token, ".")
	if len(segments) != 3 || segmentIndex < 0 || segmentIndex > 1 {
		return nil, errors.New("vector lacks a JWT segment")
	}
	data, err := base64.RawURLEncoding.DecodeString(segments[segmentIndex])
	if err != nil || base64.RawURLEncoding.EncodeToString(data) != segments[segmentIndex] {
		return nil, errors.New("vector segment is not canonical base64url")
	}
	var object map[string]any
	if err = json.Unmarshal(data, &object); err != nil || object == nil {
		return nil, errors.New("vector segment is not inspectable JSON")
	}
	return object, nil
}

func jsonEvidenceMetrics(root any) (int, int) {
	stack := []any{root}
	values := 0
	maximumStringBytes := 0
	for len(stack) > 0 {
		value := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		values++
		switch typed := value.(type) {
		case string:
			if len(typed) > maximumStringBytes {
				maximumStringBytes = len(typed)
			}
		case []any:
			stack = append(stack, typed...)
		case map[string]any:
			for _, child := range typed {
				stack = append(stack, child)
			}
		}
	}
	return values, maximumStringBytes
}

func validateRequiredVectorEvidence(fixture *Fixture) error {
	rsaVector, err := fixtureVector(fixture, "valid_firebase_rs256_3072")
	if err != nil {
		return err
	}
	header, err := decodedVectorObject(rsaVector, 0)
	if err != nil {
		return err
	}
	kid, _ := header["kid"].(string)
	rsaBits := 0
	for _, key := range fixture.KeySets["firebase"].Keys {
		if key.KID != kid {
			continue
		}
		modulus, decodeErr := decodeBase64URL(key.N, "RSA n", -1)
		if decodeErr == nil {
			rsaBits = new(big.Int).SetBytes(modulus).BitLen()
		}
	}
	if !rsaVector.Valid || rsaBits != 3_072 {
		return errors.New("valid_firebase_rs256_3072 does not exercise RSA-3072")
	}

	oversized, err := fixtureVector(fixture, "firebase_oversized_json_string")
	if err != nil {
		return err
	}
	oversizedClaims, err := decodedVectorObject(oversized, 1)
	if err != nil {
		return err
	}
	_, maximumStringBytes := jsonEvidenceMetrics(oversizedClaims)
	if maximumStringBytes <= 4_096 {
		return errors.New("firebase_oversized_json_string does not exceed the string bound")
	}

	excessive, err := fixtureVector(fixture, "firebase_excessive_json_values")
	if err != nil {
		return err
	}
	excessiveClaims, err := decodedVectorObject(excessive, 1)
	if err != nil {
		return err
	}
	values, _ := jsonEvidenceMetrics(excessiveClaims)
	if values <= 2_048 {
		return errors.New("firebase_excessive_json_values does not exceed the value bound")
	}

	stale, err := fixtureVector(fixture, "firebase_stale_authentication")
	if err != nil {
		return err
	}
	owner, err := fixtureVector(fixture, "valid_firebase_verified_email")
	if err != nil {
		return err
	}
	staleClaims, staleErr := decodedVectorObject(stale, 1)
	ownerClaims, ownerErr := decodedVectorObject(owner, 1)
	authenticatedAt, authOK := staleClaims["auth_time"].(float64)
	if staleErr != nil || ownerErr != nil || staleClaims["sub"] != ownerClaims["sub"] || !authOK || authenticatedAt > float64(fixture.Now-601) {
		return errors.New("firebase_stale_authentication is not a stale token for the owner")
	}
	return nil
}

func expectedVectorKeySet(fixture *Fixture, vector TokenVector) (string, error) {
	if vector.Kind == "firebase" {
		return "firebase", nil
	}
	transitions := fixture.Rotation.Transitions
	if len(transitions) != 4 || vector.VerificationTime < transitions[0].At {
		return "", errors.New("access-token vector predates the rotation timeline")
	}
	if vector.VerificationTime < transitions[1].At {
		return "initial", nil
	}
	if vector.VerificationTime < transitions[2].At {
		return "prepublished", nil
	}
	if vector.VerificationTime < transitions[3].At {
		return "rotated", nil
	}
	return "retired", nil
}

func keySetIDs(fixture *Fixture, name string) map[string]struct{} {
	ids := make(map[string]struct{})
	for _, key := range fixture.KeySets[name].Keys {
		ids[key.KID] = struct{}{}
	}
	return ids
}

func hasKey(ids map[string]struct{}, kid string) bool {
	_, exists := ids[kid]
	return exists
}

func validateRotationProfile(fixture *Fixture) error {
	transitions := fixture.Rotation.Transitions
	phases := []string{"initial", "prepublished", "activated", "retiring_removed"}
	keySets := []string{"initial", "prepublished", "rotated", "retired"}
	if len(transitions) != len(phases) || !asciiID.MatchString(fixture.Rotation.RetiringKID) {
		return errors.New("rotation requires four explicit transitions")
	}
	for index, transition := range transitions {
		if transition.Phase != phases[index] || transition.KeySet != keySets[index] || !asciiID.MatchString(transition.SigningKID) {
			return errors.New("rotation transitions are not the canonical sequence")
		}
	}
	initial := transitions[0]
	prepublished := transitions[1]
	activated := transitions[2]
	removed := transitions[3]
	if activated.At-prepublished.At < 60 || fixture.Rotation.RetiringLastIssuedAt != activated.At || removed.At-fixture.Rotation.RetiringLastIssuedAt < 330 || initial.At >= prepublished.At || initial.SigningKID != prepublished.SigningKID || fixture.Rotation.RetiringKID != prepublished.SigningKID || activated.SigningKID != removed.SigningKID || activated.SigningKID == prepublished.SigningKID {
		return errors.New("rotation timing or signing transitions are unsafe")
	}
	initialIDs := keySetIDs(fixture, "initial")
	prepublishedIDs := keySetIDs(fixture, "prepublished")
	rotatedIDs := keySetIDs(fixture, "rotated")
	retiredIDs := keySetIDs(fixture, "retired")
	retiring := fixture.Rotation.RetiringKID
	future := activated.SigningKID
	if !hasKey(initialIDs, retiring) || !hasKey(initialIDs, initial.SigningKID) || hasKey(initialIDs, future) || !hasKey(prepublishedIDs, retiring) || !hasKey(prepublishedIDs, prepublished.SigningKID) || !hasKey(prepublishedIDs, future) || !hasKey(rotatedIDs, retiring) || !hasKey(rotatedIDs, future) || hasKey(retiredIDs, retiring) || !hasKey(retiredIDs, future) {
		return errors.New("rotation key-set membership is unsafe")
	}
	return nil
}

func decodeBase64URL(value, label string, expectedLength int) ([]byte, error) {
	if value == "" || !base64URL.MatchString(value) {
		return nil, fmt.Errorf("%s is not unpadded base64url", label)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, fmt.Errorf("%s is not canonical base64url", label)
	}
	if expectedLength >= 0 && len(decoded) != expectedLength {
		return nil, fmt.Errorf("%s has invalid decoded length", label)
	}
	return decoded, nil
}

func ParseHomeKey(value string) (string, []byte, error) {
	match := homeKeyPattern.FindStringSubmatch(value)
	if len(match) != 3 {
		return "", nil, errors.New("invalid Home Key")
	}
	if _, err := decodeBase64URL(match[1], "Home Key ID", 16); err != nil {
		return "", nil, errors.New("invalid Home Key")
	}
	secret, err := decodeBase64URL(match[2], "Home Key secret", 32)
	if err != nil {
		return "", nil, errors.New("invalid Home Key")
	}
	return match[1], secret, nil
}

func DeriveHomeKeyVerifier(homeKey string, pepper []byte) (string, error) {
	if _, _, err := ParseHomeKey(homeKey); err != nil || len(pepper) != 32 {
		return "", errors.New("invalid Home Key verifier input")
	}
	digest := hmac.New(sha256.New, pepper)
	_, _ = digest.Write([]byte(homeKey))
	return base64.RawURLEncoding.EncodeToString(digest.Sum(nil)), nil
}
