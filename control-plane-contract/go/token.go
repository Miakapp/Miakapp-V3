package controlplane

import (
	"bytes"
	"crypto"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MalformedToken   = "malformed_token"
	InvalidHeader    = "invalid_header"
	UnknownKID       = "unknown_kid"
	InvalidSignature = "invalid_signature"
	InvalidIssuer    = "invalid_issuer"
	InvalidAudience  = "invalid_audience"
	Expired          = "expired"
	InvalidTime      = "invalid_time"
	InvalidScope     = "invalid_scope"
	InvalidProfile   = "invalid_profile"
	InvalidClaims    = "invalid_claims"
)

var (
	homeIDPattern          = regexp.MustCompile(`^[a-z][a-z0-9-]{1,61}[a-z0-9]$`)
	coordinatorNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
)

type VerificationError struct {
	Code string
}

func (err *VerificationError) Error() string {
	return err.Code
}

func verificationFailure(code string) error {
	return &VerificationError{Code: code}
}

func VerificationCode(err error) string {
	var failure *VerificationError
	if errors.As(err, &failure) {
		return failure.Code
	}
	return ""
}

type AccessIdentity interface {
	isAccessIdentity()
}

type HomeKeyAccessIdentity struct {
	HomeID          string  `json:"home_id"`
	PrincipalID     string  `json:"principal_id"`
	ClientID        string  `json:"client_id"`
	Scope           string  `json:"scope"`
	ExpiresAt       int64   `json:"expires_at"`
	Role            *string `json:"role"`
	CoordinatorName *string `json:"coordinator_name"`
}

func (*HomeKeyAccessIdentity) isAccessIdentity() {}

type UserAccessIdentity struct {
	HomeID        string  `json:"home_id"`
	PrincipalID   string  `json:"principal_id"`
	Scope         string  `json:"scope"`
	ExpiresAt     int64   `json:"expires_at"`
	Role          string  `json:"role"`
	VerifiedEmail *string `json:"verified_email"`
}

func (*UserAccessIdentity) isAccessIdentity() {}

func verifyUserAccessClaims(claims map[string]any, fixture *Fixture) (*UserAccessIdentity, error) {
	required := []string{"iss", "sub", "aud", "exp", "iat", "jti", "scope", "miakapp_home", "miakapp_role"}
	if err := exactObjectKeys(claims, required, []string{"miakapp_verified_email"}, InvalidClaims); err != nil {
		return nil, err
	}
	if claims["iss"] != fixture.Deployment.Issuer {
		return nil, verificationFailure(InvalidIssuer)
	}
	if claims["aud"] != fixture.Deployment.RelayAudience {
		return nil, verificationFailure(InvalidAudience)
	}
	issuedAt, err := integerValueClaim(claims["iat"])
	if err != nil {
		return nil, err
	}
	expiresAt, err := integerValueClaim(claims["exp"])
	if err != nil {
		return nil, err
	}
	if expiresAt <= fixture.Now {
		return nil, verificationFailure(Expired)
	}
	if issuedAt > fixture.Now+30 || expiresAt <= issuedAt || expiresAt-issuedAt > 300 || expiresAt > fixture.Now+300 {
		return nil, verificationFailure(InvalidTime)
	}
	tokenID, err := stringValueClaim(claims["jti"], 22)
	if err != nil {
		return nil, err
	}
	if _, err = decodeBase64URL(tokenID, "jti", 16); err != nil {
		return nil, verificationFailure(InvalidClaims)
	}
	scope, ok := claims["scope"].(string)
	if !ok || scope != "relay:user" {
		if ok && strings.Contains(scope, " ") {
			return nil, verificationFailure(InvalidScope)
		}
		return nil, verificationFailure(InvalidProfile)
	}
	if claims["miakapp_role"] != "user" {
		return nil, verificationFailure(InvalidProfile)
	}
	homeID, err := stringValueClaim(claims["miakapp_home"], 63)
	if err != nil || !homeIDPattern.MatchString(homeID) {
		return nil, verificationFailure(InvalidClaims)
	}
	principalID, err := stringValueClaim(claims["sub"], 128)
	if err != nil {
		return nil, err
	}
	var verifiedEmail *string
	if claim, exists := claims["miakapp_verified_email"]; exists {
		email, emailErr := stringValueClaim(claim, 320)
		if emailErr != nil {
			return nil, emailErr
		}
		verifiedEmail = &email
	}
	return &UserAccessIdentity{
		HomeID: homeID, PrincipalID: principalID, Scope: scope, ExpiresAt: expiresAt,
		Role: "user", VerifiedEmail: verifiedEmail,
	}, nil
}

type FirebaseIdentity struct {
	UserID          string  `json:"user_id"`
	VerifiedEmail   *string `json:"verified_email"`
	AuthenticatedAt int64   `json:"authenticated_at"`
	ExpiresAt       int64   `json:"expires_at"`
}

type parsedToken struct {
	header       map[string]any
	claims       map[string]any
	signature    []byte
	signingInput []byte
}

func decodeJSONObject(data []byte) (map[string]any, error) {
	if err := validateJSONWithLimits(data, tokenJSONLimits); err != nil {
		return nil, verificationFailure(MalformedToken)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil || object == nil {
		return nil, verificationFailure(MalformedToken)
	}
	return object, nil
}

func decodeTokenSegment(segment string, maximum int) ([]byte, error) {
	if segment == "" || !base64URL.MatchString(segment) {
		return nil, verificationFailure(MalformedToken)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil || len(decoded) > maximum || base64.RawURLEncoding.EncodeToString(decoded) != segment {
		return nil, verificationFailure(MalformedToken)
	}
	return decoded, nil
}

func parseCompactToken(token string) (*parsedToken, error) {
	if token == "" || len(token) > MaxTokenBytes {
		return nil, verificationFailure(MalformedToken)
	}
	for _, character := range []byte(token) {
		if character < 0x21 || character > 0x7e {
			return nil, verificationFailure(MalformedToken)
		}
	}
	segments := strings.Split(token, ".")
	if len(segments) != 3 {
		return nil, verificationFailure(MalformedToken)
	}
	headerData, err := decodeTokenSegment(segments[0], 2_048)
	if err != nil {
		return nil, err
	}
	claimsData, err := decodeTokenSegment(segments[1], 12_288)
	if err != nil {
		return nil, err
	}
	signature, err := decodeTokenSegment(segments[2], 512)
	if err != nil {
		return nil, err
	}
	header, err := decodeJSONObject(headerData)
	if err != nil {
		return nil, err
	}
	claims, err := decodeJSONObject(claimsData)
	if err != nil {
		return nil, err
	}
	return &parsedToken{
		header:       header,
		claims:       claims,
		signature:    signature,
		signingInput: []byte(segments[0] + "." + segments[1]),
	}, nil
}

func exactObjectKeys(object map[string]any, required, optional []string, code string) error {
	allowed := make(map[string]struct{}, len(required)+len(optional))
	for _, key := range required {
		allowed[key] = struct{}{}
		if _, exists := object[key]; !exists {
			return verificationFailure(code)
		}
	}
	for _, key := range optional {
		allowed[key] = struct{}{}
	}
	for key := range object {
		if _, exists := allowed[key]; !exists {
			return verificationFailure(code)
		}
	}
	return nil
}

func stringValueClaim(value any, maximum int) (string, error) {
	text, ok := value.(string)
	if !ok || text == "" || len(text) > maximum || !utf8.ValidString(text) {
		return "", verificationFailure(InvalidClaims)
	}
	for _, character := range text {
		if unicode.IsControl(character) {
			return "", verificationFailure(InvalidClaims)
		}
	}
	return text, nil
}

func integerValueClaim(value any) (int64, error) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, verificationFailure(InvalidClaims)
	}
	parsed, err := number.Float64()
	if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) || math.Trunc(parsed) != parsed {
		return 0, verificationFailure(InvalidClaims)
	}
	if parsed < -9_007_199_254_740_991 || parsed > 9_007_199_254_740_991 {
		return 0, verificationFailure(InvalidClaims)
	}
	return int64(parsed), nil
}

func selectJWK(keys []PublicJWK, value any) (PublicJWK, error) {
	kid, ok := value.(string)
	if !ok || kid == "" || len(kid) > 128 {
		return PublicJWK{}, verificationFailure(InvalidHeader)
	}
	for _, key := range keys {
		if key.KID == kid {
			return key, nil
		}
	}
	return PublicJWK{}, verificationFailure(UnknownKID)
}

func verifyEd25519Signature(token *parsedToken, key PublicJWK) error {
	if key.KTY != "OKP" || key.CRV != "Ed25519" || key.Use != "sig" || key.Alg != "EdDSA" || len(token.signature) != ed25519.SignatureSize {
		return verificationFailure(InvalidHeader)
	}
	publicKey, err := decodeBase64URL(key.X, "Ed25519 x", ed25519.PublicKeySize)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), token.signingInput, token.signature) {
		return verificationFailure(InvalidSignature)
	}
	return nil
}

func verifyRS256Signature(token *parsedToken, key PublicJWK) error {
	if key.KTY != "RSA" || key.Use != "sig" || key.Alg != "RS256" {
		return verificationFailure(InvalidHeader)
	}
	modulusBytes, err := decodeBase64URL(key.N, "RSA n", -1)
	modulus := new(big.Int).SetBytes(modulusBytes)
	if err != nil || modulus.BitLen() < 2_048 || modulus.BitLen() > 4_096 || len(modulusBytes) == 0 || modulusBytes[0] == 0 || len(token.signature) != len(modulusBytes) {
		return verificationFailure(InvalidHeader)
	}
	exponentBytes, err := decodeBase64URL(key.E, "RSA e", -1)
	if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
		return verificationFailure(InvalidHeader)
	}
	exponent := 0
	for _, value := range exponentBytes {
		exponent = exponent<<8 | int(value)
	}
	if exponent < 3 || exponent%2 == 0 {
		return verificationFailure(InvalidHeader)
	}
	digest := sha256.Sum256(token.signingInput)
	publicKey := &rsa.PublicKey{N: modulus, E: exponent}
	if err = rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], token.signature); err != nil {
		return verificationFailure(InvalidSignature)
	}
	return nil
}

func profileRequirements(fixture *Fixture, profile string) (string, string, *string, error) {
	switch profile {
	case "coordinator":
		role := "coordinator"
		return fixture.Deployment.RelayAudience, "relay:coordinator", &role, nil
	case "cli":
		role := "cli"
		return fixture.Deployment.RelayAudience, "relay:cli", &role, nil
	case "push":
		return fixture.Deployment.PushAudience, "push:send", nil, nil
	case "components":
		return fixture.Deployment.ComponentsAudience, "components:publish", nil, nil
	default:
		return "", "", nil, verificationFailure(InvalidProfile)
	}
}

type commonAccessClaims struct {
	homeID    string
	clientID  string
	scope     string
	expiresAt int64
}

func validateCommonAccessClaims(claims map[string]any, fixture *Fixture, profile string) (*commonAccessClaims, error) {
	audience, expectedScope, _, err := profileRequirements(fixture, profile)
	if err != nil {
		return nil, err
	}
	if claims["iss"] != fixture.Deployment.Issuer {
		return nil, verificationFailure(InvalidIssuer)
	}
	if claims["aud"] != audience {
		return nil, verificationFailure(InvalidAudience)
	}
	issuedAt, err := integerValueClaim(claims["iat"])
	if err != nil {
		return nil, err
	}
	expiresAt, err := integerValueClaim(claims["exp"])
	if err != nil {
		return nil, err
	}
	if expiresAt <= fixture.Now {
		return nil, verificationFailure(Expired)
	}
	if issuedAt > fixture.Now+30 || expiresAt <= issuedAt || expiresAt-issuedAt > 300 || expiresAt > fixture.Now+300 {
		return nil, verificationFailure(InvalidTime)
	}
	homeID, err := stringValueClaim(claims["sub"], 63)
	if err != nil || !homeIDPattern.MatchString(homeID) {
		return nil, verificationFailure(InvalidClaims)
	}
	clientID, err := stringValueClaim(claims["client_id"], 22)
	if err != nil {
		return nil, err
	}
	jti, err := stringValueClaim(claims["jti"], 22)
	if err != nil {
		return nil, err
	}
	if _, err = decodeBase64URL(clientID, "client_id", 16); err != nil {
		return nil, verificationFailure(InvalidClaims)
	}
	if _, err = decodeBase64URL(jti, "jti", 16); err != nil {
		return nil, verificationFailure(InvalidClaims)
	}
	scope, ok := claims["scope"].(string)
	if !ok || scope != expectedScope {
		if ok && strings.Contains(scope, " ") {
			return nil, verificationFailure(InvalidScope)
		}
		return nil, verificationFailure(InvalidProfile)
	}
	return &commonAccessClaims{homeID: homeID, clientID: clientID, scope: scope, expiresAt: expiresAt}, nil
}

func VerifyMiakappAccessToken(token string, fixture *Fixture, profile string, keys []PublicJWK) (AccessIdentity, error) {
	parsed, err := parseCompactToken(token)
	if err != nil {
		return nil, err
	}
	if err = exactObjectKeys(parsed.header, []string{"alg", "kid", "typ"}, nil, InvalidHeader); err != nil {
		return nil, err
	}
	if parsed.header["alg"] != "EdDSA" || parsed.header["typ"] != "at+jwt" {
		return nil, verificationFailure(InvalidHeader)
	}
	key, err := selectJWK(keys, parsed.header["kid"])
	if err != nil {
		return nil, err
	}
	if err = verifyEd25519Signature(parsed, key); err != nil {
		return nil, err
	}
	if profile == "user" {
		return verifyUserAccessClaims(parsed.claims, fixture)
	}
	common, err := validateCommonAccessClaims(parsed.claims, fixture, profile)
	if err != nil {
		return nil, err
	}
	commonFields := []string{"iss", "sub", "aud", "exp", "iat", "jti", "client_id", "scope"}
	switch profile {
	case "coordinator":
		if err = exactObjectKeys(parsed.claims, commonFields, []string{"miakapp_role", "miakapp_coordinator"}, InvalidClaims); err != nil {
			return nil, err
		}
	case "cli":
		if err = exactObjectKeys(parsed.claims, commonFields, []string{"miakapp_role"}, InvalidClaims); err != nil {
			return nil, err
		}
	default:
		if err = exactObjectKeys(parsed.claims, commonFields, nil, InvalidClaims); err != nil {
			return nil, err
		}
	}
	_, _, requiredRole, err := profileRequirements(fixture, profile)
	if err != nil {
		return nil, err
	}
	var role *string
	var coordinatorName *string
	if requiredRole != nil {
		claimRole, ok := parsed.claims["miakapp_role"].(string)
		if !ok || claimRole != *requiredRole {
			return nil, verificationFailure(InvalidProfile)
		}
		roleValue := claimRole
		role = &roleValue
	}
	if profile == "coordinator" {
		name, ok := parsed.claims["miakapp_coordinator"].(string)
		if !ok || !coordinatorNamePattern.MatchString(name) {
			return nil, verificationFailure(InvalidProfile)
		}
		coordinatorName = &name
	}
	return &HomeKeyAccessIdentity{
		HomeID:          common.homeID,
		PrincipalID:     common.homeID,
		ClientID:        common.clientID,
		Scope:           common.scope,
		ExpiresAt:       common.expiresAt,
		Role:            role,
		CoordinatorName: coordinatorName,
	}, nil
}

func VerifyFirebaseIDToken(token string, fixture *Fixture, keys []PublicJWK) (*FirebaseIdentity, error) {
	parsed, err := parseCompactToken(token)
	if err != nil {
		return nil, err
	}
	if err = exactObjectKeys(parsed.header, []string{"alg", "kid"}, []string{"typ"}, InvalidHeader); err != nil {
		return nil, err
	}
	if parsed.header["alg"] != "RS256" {
		return nil, verificationFailure(InvalidHeader)
	}
	if tokenType, exists := parsed.header["typ"]; exists && tokenType != "JWT" {
		return nil, verificationFailure(InvalidHeader)
	}
	key, err := selectJWK(keys, parsed.header["kid"])
	if err != nil {
		return nil, err
	}
	if err = verifyRS256Signature(parsed, key); err != nil {
		return nil, err
	}
	if parsed.claims["iss"] != fixture.Firebase.Issuer {
		return nil, verificationFailure(InvalidIssuer)
	}
	if parsed.claims["aud"] != fixture.Firebase.ProjectID {
		return nil, verificationFailure(InvalidAudience)
	}
	expiresAt, err := integerValueClaim(parsed.claims["exp"])
	if err != nil {
		return nil, err
	}
	if expiresAt <= fixture.Now {
		return nil, verificationFailure(Expired)
	}
	issuedAt, err := integerValueClaim(parsed.claims["iat"])
	if err != nil {
		return nil, err
	}
	authenticatedAt, err := integerValueClaim(parsed.claims["auth_time"])
	if err != nil {
		return nil, err
	}
	if issuedAt > fixture.Now+30 || authenticatedAt > fixture.Now+30 {
		return nil, verificationFailure(InvalidTime)
	}
	userID, err := stringValueClaim(parsed.claims["sub"], 128)
	if err != nil {
		return nil, err
	}
	var verifiedEmail *string
	if verified, exists := parsed.claims["email_verified"]; exists {
		verifiedBoolean, ok := verified.(bool)
		if !ok {
			return nil, verificationFailure(InvalidClaims)
		}
		if verifiedBoolean {
			email, emailErr := stringValueClaim(parsed.claims["email"], 320)
			if emailErr != nil {
				return nil, emailErr
			}
			verifiedEmail = &email
		}
	}
	return &FirebaseIdentity{
		UserID:          userID,
		VerifiedEmail:   verifiedEmail,
		AuthenticatedAt: authenticatedAt,
		ExpiresAt:       expiresAt,
	}, nil
}

func VerifyVector(vector TokenVector, fixture *Fixture) (any, error) {
	keySet, exists := fixture.KeySets[vector.KeySet]
	if !exists {
		return nil, verificationFailure(UnknownKID)
	}
	verificationFixture := *fixture
	verificationFixture.Now = vector.VerificationTime
	if vector.Kind == "firebase" {
		return VerifyFirebaseIDToken(vector.Token, &verificationFixture, keySet.Keys)
	}
	if vector.Kind != "miakapp" {
		return nil, verificationFailure(InvalidProfile)
	}
	return VerifyMiakappAccessToken(vector.Token, &verificationFixture, vector.Profile, keySet.Keys)
}
