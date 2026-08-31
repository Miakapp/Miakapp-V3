package protocol

import (
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	OpcodeHello            byte = 0x00
	OpcodeWelcome          byte = 0x01
	OpcodeError            byte = 0x02
	OpcodeFatal            byte = 0x03
	OpcodeReauth           byte = 0x04
	OpcodeReauthOK         byte = 0x05
	OpcodeHomeStatus       byte = 0x06
	OpcodeGoaway           byte = 0x07
	OpcodeStateSync        byte = 0x10
	OpcodeStateSyncOK      byte = 0x11
	OpcodeStateDict        byte = 0x12
	OpcodeStateSnapshot    byte = 0x13
	OpcodeStatePatch       byte = 0x14
	OpcodeStateSet         byte = 0x15
	OpcodeStateSetOK       byte = 0x16
	OpcodeStateACLSync     byte = 0x17
	OpcodeStateACLOK       byte = 0x18
	OpcodeStateResync      byte = 0x19
	OpcodeEventSync        byte = 0x20
	OpcodeEventSyncOK      byte = 0x21
	OpcodeTopicDict        byte = 0x22
	OpcodeEventACLSync     byte = 0x23
	OpcodeEventACLOK       byte = 0x24
	OpcodeSubscribe        byte = 0x25
	OpcodeSubscribeOK      byte = 0x26
	OpcodeUnsubscribe      byte = 0x27
	OpcodeUnsubscribeOK    byte = 0x28
	OpcodeEvent            byte = 0x29
	OpcodeFunctionSync     byte = 0x30
	OpcodeFunctionSyncOK   byte = 0x31
	OpcodeFunctionDict     byte = 0x32
	OpcodeCall             byte = 0x33
	OpcodeCallDispatch     byte = 0x34
	OpcodeCallAccepted     byte = 0x35
	OpcodeCallResult       byte = 0x36
	OpcodeCallError        byte = 0x37
	OpcodeCallCancel       byte = 0x38
	OpcodeCallCredit       byte = 0x39
	OpcodePresenceSnapshot byte = 0x40
	OpcodePresenceChange   byte = 0x41
)

const (
	MaxStatePathsPerCoordinator = 4_096
	MaxStatePathsPerHome        = 16_384
	MaxDeclarations             = 1_024
	MaxSubscriptions            = 256
	MaxInflightCalls            = 128
	MaxStreamCredit             = 32
	MaxCallTimeoutMS            = 300_000
)

const (
	applicationErrorCodeMinimum int64 = 2000
	applicationErrorCodeMaximum int64 = 2999
)

var coordinatorNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type Frame struct {
	Opcode  byte
	Payload []any
}

func knownCoreOpcode(opcode byte) bool {
	switch {
	case opcode <= OpcodeGoaway:
		return true
	case opcode >= OpcodeStateSync && opcode <= OpcodeStateResync:
		return true
	case opcode >= OpcodeEventSync && opcode <= OpcodeEvent:
		return true
	case opcode >= OpcodeFunctionSync && opcode <= OpcodeCallCredit:
		return true
	case opcode >= OpcodePresenceSnapshot && opcode <= OpcodePresenceChange:
		return true
	default:
		return false
	}
}

func errorCorrelationSourceOpcode(opcode byte) bool {
	switch opcode {
	case OpcodeReauth,
		OpcodeStateSync,
		OpcodeStateSet,
		OpcodeStateACLSync,
		OpcodeStateResync,
		OpcodeEventSync,
		OpcodeEventACLSync,
		OpcodeSubscribe,
		OpcodeUnsubscribe,
		OpcodeEvent,
		OpcodeFunctionSync,
		OpcodeCall,
		OpcodeCallResult,
		OpcodeCallError,
		OpcodeCallCancel,
		OpcodeCallCredit:
		return true
	default:
		return false
	}
}

func knownCoreErrorCode(code int64) bool {
	switch code {
	case 1000, 1001, 1002, 1003, 1004, 1005,
		1100, 1101, 1102,
		1200, 1201, 1202, 1203,
		1300, 1301, 1302, 1303, 1304, 1305,
		1400, 1401, 1402, 1403, 1404, 1405,
		1500:
		return true
	default:
		return false
	}
}

func asArray(value any, label string, maximum int) ([]any, error) {
	array, ok := value.([]any)
	if !ok || len(array) > maximum {
		return nil, protocolError(ErrInvalidFrame, "%s must be an array", label)
	}
	return array, nil
}

func exactTuple(value any, length int, label string) ([]any, error) {
	array, err := asArray(value, label, MaxArrayItems)
	if err != nil {
		return nil, err
	}
	if len(array) != length {
		return nil, protocolError(ErrInvalidFrame, "%s must contain %d fields", label, length)
	}
	return array, nil
}

func integerValue(value any) (int64, bool) {
	switch number := value.(type) {
	case int:
		return int64(number), true
	case int8:
		return int64(number), true
	case int16:
		return int64(number), true
	case int32:
		return int64(number), true
	case int64:
		return number, true
	case uint:
		if uint64(number) <= uint64(maxSafeInteger) {
			return int64(number), true
		}
	case uint8:
		return int64(number), true
	case uint16:
		return int64(number), true
	case uint32:
		return int64(number), true
	case uint64:
		if number <= uint64(maxSafeInteger) {
			return int64(number), true
		}
	case float32:
		floating := float64(number)
		if floating == 0 && math.Signbit(floating) {
			return 0, false
		}
		if math.Trunc(floating) == floating && floating >= float64(minSafeInteger) && floating <= float64(maxSafeInteger) {
			return int64(floating), true
		}
	case float64:
		if number == 0 && math.Signbit(number) {
			return 0, false
		}
		if math.Trunc(number) == number && number >= float64(minSafeInteger) && number <= float64(maxSafeInteger) {
			return int64(number), true
		}
	}
	return 0, false
}

func integer(value any, minimum, maximum int64, label string) (int64, error) {
	number, ok := integerValue(value)
	if !ok || number < minimum || number > maximum {
		return 0, protocolError(ErrInvalidFrame, "%s must be an integer in range", label)
	}
	return number, nil
}

func coreErrorCode(value any, label string) (int64, error) {
	code, err := integer(value, 1, 0xffff, label)
	if err != nil {
		return 0, err
	}
	if !knownCoreErrorCode(code) {
		return 0, protocolError(ErrInvalidFrame, "%s is not a known core error code", label)
	}
	return code, nil
}

func callErrorCode(value any, label string) (int64, error) {
	code, err := integer(value, 1, 0xffff, label)
	if err != nil {
		return 0, err
	}
	isApplicationCode := code >= applicationErrorCodeMinimum && code <= applicationErrorCodeMaximum
	if !knownCoreErrorCode(code) && !isApplicationCode {
		return 0, protocolError(ErrInvalidFrame, "%s is not a permitted call error code", label)
	}
	return code, nil
}

func errorCorrelation(correlationValue, sourceOpcodeValue any) error {
	correlationID, err := integer(correlationValue, 0, maxSafeInteger, "ERROR.correlationId")
	if err != nil {
		return err
	}
	sourceOpcode, err := integer(sourceOpcodeValue, 0, 0xff, "ERROR.sourceOpcode")
	if err != nil {
		return err
	}
	if correlationID == 0 {
		if sourceOpcode != 0 {
			return protocolError(ErrInvalidFrame, "ERROR.sourceOpcode must be zero without an origin")
		}
		return nil
	}
	if !errorCorrelationSourceOpcode(byte(sourceOpcode)) {
		return protocolError(ErrInvalidFrame, "ERROR.sourceOpcode is not an originating frame")
	}
	return nil
}

func positiveID(value any, label string) (int64, error) {
	return integer(value, 1, maxSafeInteger, label)
}

func booleanValue(value any, label string) error {
	if _, ok := value.(bool); !ok {
		return protocolError(ErrInvalidFrame, "%s must be a boolean", label)
	}
	return nil
}

func stringValue(value any, minimum, maximum int, label string) (string, error) {
	text, ok := value.(string)
	if !ok || !utf8.ValidString(text) || len(text) < minimum || len(text) > maximum {
		return "", protocolError(ErrInvalidFrame, "%s must be a valid string in range", label)
	}
	return text, nil
}

func nullableString(value any, maximum int, label string) error {
	if value == nil {
		return nil
	}
	_, err := stringValue(value, 1, maximum, label)
	return err
}

func binaryValue(value any, length int, label string) error {
	binaryData, ok := value.([]byte)
	if !ok || len(binaryData) != length {
		return protocolError(ErrInvalidFrame, "%s must contain %d binary bytes", label, length)
	}
	return nil
}

func containsControl(value string) bool {
	for _, character := range value {
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

func opaqueID(value any, label string) (string, error) {
	text, err := stringValue(value, 1, 128, label)
	if err != nil {
		return "", err
	}
	if containsControl(text) {
		return "", protocolError(ErrInvalidFrame, "%s contains a control character", label)
	}
	return text, nil
}

func coordinatorName(value any, label string) (string, error) {
	text, err := stringValue(value, 1, 64, label)
	if err != nil {
		return "", err
	}
	if !coordinatorNamePattern.MatchString(text) {
		return "", protocolError(ErrInvalidFrame, "%s is not a coordinator name", label)
	}
	return text, nil
}

func structuredName(value any, label string) (string, error) {
	text, err := stringValue(value, 1, 256, label)
	if err != nil {
		return "", err
	}
	if containsControl(text) || strings.Contains(text, "*") || strings.HasPrefix(text, ".") || strings.HasSuffix(text, ".") || strings.Contains(text, "..") {
		return "", protocolError(ErrInvalidFrame, "%s is not a valid dotted name", label)
	}
	return text, nil
}

func pattern(value any, label string) (string, error) {
	text, err := stringValue(value, 1, 256, label)
	if err != nil {
		return "", err
	}
	base := text
	if strings.HasSuffix(text, ".*") {
		base = strings.TrimSuffix(text, ".*")
	}
	if _, err := structuredName(base, label); err != nil {
		return "", err
	}
	return text, nil
}

func validateUniqueStrings(values []any, validator func(any, string) (string, error), label string) error {
	seen := make(map[string]struct{}, len(values))
	for index, value := range values {
		item, err := validator(value, label)
		if err != nil {
			return err
		}
		if _, exists := seen[item]; exists {
			return protocolError(ErrInvalidFrame, "%s contains a duplicate at %d", label, index)
		}
		seen[item] = struct{}{}
	}
	return nil
}

func validateUniqueIDs(values []any, label string) error {
	seen := make(map[int64]struct{}, len(values))
	for index, value := range values {
		item, err := positiveID(value, label)
		if err != nil {
			return err
		}
		if _, exists := seen[item]; exists {
			return protocolError(ErrInvalidFrame, "%s contains a duplicate at %d", label, index)
		}
		seen[item] = struct{}{}
	}
	return nil
}

func validateEpoch(value any, label string) error {
	return binaryValue(value, 16, label)
}

func validateCoordinators(value any, label string) error {
	entries, err := asArray(value, label, 64)
	if err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(entries))
	for index, entry := range entries {
		fields, err := exactTuple(entry, 3, label)
		if err != nil {
			return err
		}
		name, err := coordinatorName(fields[0], label)
		if err != nil {
			return err
		}
		if _, exists := seen[name]; exists {
			return protocolError(ErrInvalidFrame, "%s contains a duplicate coordinator", label)
		}
		seen[name] = struct{}{}
		if _, err = positiveID(fields[1], label); err != nil {
			return err
		}
		if _, err = integer(fields[2], 1, 2, label); err != nil {
			return err
		}
		_ = index
	}
	return nil
}

func validateDictionary(value any, maximum int, label string) error {
	entries, err := asArray(value, label, maximum)
	if err != nil {
		return err
	}
	ids := make(map[int64]struct{}, len(entries))
	names := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		fields, err := exactTuple(entry, 2, label)
		if err != nil {
			return err
		}
		id, err := positiveID(fields[0], label)
		if err != nil {
			return err
		}
		name, err := structuredName(fields[1], label)
		if err != nil {
			return err
		}
		if _, exists := ids[id]; exists {
			return protocolError(ErrInvalidFrame, "%s contains a duplicate ID", label)
		}
		if _, exists := names[name]; exists {
			return protocolError(ErrInvalidFrame, "%s contains a duplicate name", label)
		}
		ids[id] = struct{}{}
		names[name] = struct{}{}
	}
	return nil
}

func validateMutations(value any, label string) error {
	entries, err := asArray(value, label, MaxStatePathsPerCoordinator)
	if err != nil {
		return err
	}
	ids := make(map[int64]struct{}, len(entries))
	for _, entry := range entries {
		fields, err := asArray(entry, label, 3)
		if err != nil || (len(fields) != 2 && len(fields) != 3) {
			return protocolError(ErrInvalidFrame, "%s mutation has wrong arity", label)
		}
		id, err := positiveID(fields[0], label)
		if err != nil {
			return err
		}
		if _, exists := ids[id]; exists {
			return protocolError(ErrInvalidFrame, "%s contains a duplicate path ID", label)
		}
		ids[id] = struct{}{}
		operation, err := integer(fields[1], 0, 1, label)
		if err != nil {
			return err
		}
		if (operation == 0 && len(fields) != 3) || (operation == 1 && len(fields) != 2) {
			return protocolError(ErrInvalidFrame, "%s mutation arity does not match operation", label)
		}
	}
	return nil
}

func validatePatterns(value any, label string) error {
	values, err := asArray(value, label, MaxArrayItems)
	if err != nil {
		return err
	}
	return validateUniqueStrings(values, pattern, label)
}

func validateTarget(kindValue, targetValue any, label string) error {
	kind, err := integer(kindValue, 0, 2, label)
	if err != nil {
		return err
	}
	switch kind {
	case 0:
		if targetValue != nil {
			return protocolError(ErrInvalidFrame, "%s default target must be null", label)
		}
	case 1:
		_, err = positiveID(targetValue, label)
	case 2:
		_, err = coordinatorName(targetValue, label)
	}
	return err
}

func validatePrincipal(value any, label string) error {
	fields, err := exactTuple(value, 5, label)
	if err != nil {
		return err
	}
	kind, err := integer(fields[0], 1, 3, label)
	if err != nil {
		return err
	}
	if _, err = opaqueID(fields[1], label); err != nil {
		return err
	}
	if _, err = positiveID(fields[2], label); err != nil {
		return err
	}
	if kind == 2 {
		if _, err = coordinatorName(fields[3], label); err != nil {
			return err
		}
	} else if fields[3] != nil {
		return protocolError(ErrInvalidFrame, "%s coordinator name must be null", label)
	}
	return nullableString(fields[4], 320, label)
}

func validateSubscriptionPayload(payload []any, label string) error {
	fields, err := exactTuple(payload, 2, label)
	if err != nil {
		return err
	}
	if _, err = positiveID(fields[0], label); err != nil {
		return err
	}
	ids, err := asArray(fields[1], label, MaxSubscriptions)
	if err != nil {
		return err
	}
	return validateUniqueIDs(ids, label)
}

func validateFrame(frame Frame) error {
	if frame.Opcode >= 0x80 {
		return nil
	}
	if !knownCoreOpcode(frame.Opcode) {
		return protocolError(ErrUnknownOpcode, "unknown core opcode")
	}

	switch frame.Opcode {
	case OpcodeHello:
		fields, err := exactTuple(frame.Payload, 6, "HELLO")
		if err != nil {
			return err
		}
		if _, err = integer(fields[0], 0, 0xff, "HELLO.major"); err != nil {
			return err
		}
		minimum, err := integer(fields[1], 0, 0xff, "HELLO.minMinor")
		if err != nil {
			return err
		}
		maximum, err := integer(fields[2], 0, 0xff, "HELLO.maxMinor")
		if err != nil || minimum > maximum {
			return protocolError(ErrInvalidFrame, "HELLO minor range is invalid")
		}
		role, err := integer(fields[3], 1, 3, "HELLO.role")
		if err != nil {
			return err
		}
		if _, err = stringValue(fields[4], 1, 16_384, "HELLO.token"); err != nil {
			return err
		}
		context, err := asArray(fields[5], "HELLO.context", MaxArrayItems)
		if err != nil {
			return err
		}
		if role == 1 {
			roleFields, tupleErr := exactTuple(context, 1, "HELLO.userContext")
			if tupleErr != nil {
				return tupleErr
			}
			_, err = opaqueID(roleFields[0], "HELLO.homeId")
			return err
		}
		if role == 2 {
			roleFields, tupleErr := exactTuple(context, 1, "HELLO.coordinatorContext")
			if tupleErr != nil {
				return tupleErr
			}
			_, err = coordinatorName(roleFields[0], "HELLO.coordinatorName")
			return err
		}
		if len(context) != 0 {
			return protocolError(ErrInvalidFrame, "HELLO CLI context must be empty")
		}
		return nil

	case OpcodeWelcome:
		fields, err := exactTuple(frame.Payload, 8, "WELCOME")
		if err != nil {
			return err
		}
		if _, err = integer(fields[0], 0, 0xff, "WELCOME.major"); err != nil {
			return err
		}
		if _, err = integer(fields[1], 0, 0xff, "WELCOME.minor"); err != nil {
			return err
		}
		if _, err = positiveID(fields[2], "WELCOME.sessionId"); err != nil {
			return err
		}
		if err = validateEpoch(fields[3], "WELCOME.epoch"); err != nil {
			return err
		}
		if err = booleanValue(fields[4], "WELCOME.enrolled"); err != nil {
			return err
		}
		if err = validateCoordinators(fields[5], "WELCOME.coordinators"); err != nil {
			return err
		}
		limits, err := exactTuple(fields[6], 4, "WELCOME.limits")
		if err != nil {
			return err
		}
		maximums := []int64{MaxFrameBytes, MaxInflightCalls, MaxSubscriptions, 1_048_576}
		for index, maximum := range maximums {
			if _, err = integer(limits[index], 1, maximum, "WELCOME.limit"); err != nil {
				return err
			}
		}
		_, err = positiveID(fields[7], "WELCOME.expiresAtMs")
		return err

	case OpcodeError:
		fields, err := exactTuple(frame.Payload, 5, "ERROR")
		if err != nil {
			return err
		}
		if err = errorCorrelation(fields[0], fields[1]); err != nil {
			return err
		}
		if _, err = coreErrorCode(fields[2], "ERROR.code"); err != nil {
			return err
		}
		if err = booleanValue(fields[3], "ERROR.retryable"); err != nil {
			return err
		}
		_, err = stringValue(fields[4], 1, 256, "ERROR.message")
		return err

	case OpcodeFatal:
		fields, err := exactTuple(frame.Payload, 4, "FATAL")
		if err != nil {
			return err
		}
		if _, err = integer(fields[0], 0, 0xff, "FATAL.sourceOpcode"); err != nil {
			return err
		}
		if _, err = coreErrorCode(fields[1], "FATAL.code"); err != nil {
			return err
		}
		if err = booleanValue(fields[2], "FATAL.retryable"); err != nil {
			return err
		}
		_, err = stringValue(fields[3], 1, 256, "FATAL.message")
		return err

	case OpcodeReauth:
		fields, err := exactTuple(frame.Payload, 2, "REAUTH")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "REAUTH.requestId"); err != nil {
			return err
		}
		_, err = stringValue(fields[1], 1, 16_384, "REAUTH.token")
		return err

	case OpcodeReauthOK:
		fields, err := exactTuple(frame.Payload, 2, "REAUTH_OK")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "REAUTH_OK.requestId"); err != nil {
			return err
		}
		_, err = positiveID(fields[1], "REAUTH_OK.expiresAtMs")
		return err

	case OpcodeHomeStatus:
		fields, err := exactTuple(frame.Payload, 2, "HOME_STATUS")
		if err != nil {
			return err
		}
		if err = booleanValue(fields[0], "HOME_STATUS.enrolled"); err != nil {
			return err
		}
		return validateCoordinators(fields[1], "HOME_STATUS.coordinators")

	case OpcodeGoaway:
		fields, err := exactTuple(frame.Payload, 2, "GOAWAY")
		if err != nil {
			return err
		}
		if _, err = integer(fields[0], 0, MaxCallTimeoutMS, "GOAWAY.retryAfterMs"); err != nil {
			return err
		}
		_, err = integer(fields[1], 0, 0xffff, "GOAWAY.reasonCode")
		return err

	case OpcodeStateSync:
		fields, err := exactTuple(frame.Payload, 2, "STATE_SYNC")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "STATE_SYNC.requestId"); err != nil {
			return err
		}
		entries, err := asArray(fields[1], "STATE_SYNC.entries", MaxStatePathsPerCoordinator)
		if err != nil {
			return err
		}
		paths := make(map[string]struct{}, len(entries))
		for _, entry := range entries {
			item, tupleErr := exactTuple(entry, 2, "STATE_SYNC.entry")
			if tupleErr != nil {
				return tupleErr
			}
			path, nameErr := structuredName(item[0], "STATE_SYNC.path")
			if nameErr != nil {
				return nameErr
			}
			if _, exists := paths[path]; exists {
				return protocolError(ErrInvalidFrame, "STATE_SYNC contains a duplicate path")
			}
			paths[path] = struct{}{}
		}
		return nil

	case OpcodeStateSyncOK:
		fields, err := exactTuple(frame.Payload, 4, "STATE_SYNC_OK")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "STATE_SYNC_OK.requestId"); err != nil {
			return err
		}
		if err = validateEpoch(fields[1], "STATE_SYNC_OK.epoch"); err != nil {
			return err
		}
		if _, err = positiveID(fields[2], "STATE_SYNC_OK.revision"); err != nil {
			return err
		}
		return validateDictionary(fields[3], MaxStatePathsPerCoordinator, "STATE_SYNC_OK.dictionary")

	case OpcodeStateDict:
		fields, err := exactTuple(frame.Payload, 3, "STATE_DICT")
		if err != nil {
			return err
		}
		if err = validateEpoch(fields[0], "STATE_DICT.epoch"); err != nil {
			return err
		}
		if err = booleanValue(fields[1], "STATE_DICT.replace"); err != nil {
			return err
		}
		return validateDictionary(fields[2], MaxStatePathsPerHome, "STATE_DICT.dictionary")

	case OpcodeStateSnapshot:
		fields, err := exactTuple(frame.Payload, 3, "STATE_SNAPSHOT")
		if err != nil {
			return err
		}
		if err = validateEpoch(fields[0], "STATE_SNAPSHOT.epoch"); err != nil {
			return err
		}
		if _, err = positiveID(fields[1], "STATE_SNAPSHOT.revision"); err != nil {
			return err
		}
		entries, err := asArray(fields[2], "STATE_SNAPSHOT.entries", MaxStatePathsPerHome)
		if err != nil {
			return err
		}
		ids := make([]any, 0, len(entries))
		for _, entry := range entries {
			item, tupleErr := exactTuple(entry, 2, "STATE_SNAPSHOT.entry")
			if tupleErr != nil {
				return tupleErr
			}
			ids = append(ids, item[0])
		}
		return validateUniqueIDs(ids, "STATE_SNAPSHOT.pathIds")

	case OpcodeStatePatch:
		fields, err := exactTuple(frame.Payload, 4, "STATE_PATCH")
		if err != nil {
			return err
		}
		if err = validateEpoch(fields[0], "STATE_PATCH.epoch"); err != nil {
			return err
		}
		base, err := positiveID(fields[1], "STATE_PATCH.baseRevision")
		if err != nil {
			return err
		}
		revision, err := positiveID(fields[2], "STATE_PATCH.revision")
		if err != nil || revision <= base {
			return protocolError(ErrInvalidFrame, "STATE_PATCH revision must advance")
		}
		return validateMutations(fields[3], "STATE_PATCH.mutations")

	case OpcodeStateSet:
		fields, err := exactTuple(frame.Payload, 3, "STATE_SET")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "STATE_SET.requestId"); err != nil {
			return err
		}
		if err = validateEpoch(fields[1], "STATE_SET.epoch"); err != nil {
			return err
		}
		return validateMutations(fields[2], "STATE_SET.mutations")

	case OpcodeStateSetOK:
		fields, err := exactTuple(frame.Payload, 3, "STATE_SET_OK")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "STATE_SET_OK.requestId"); err != nil {
			return err
		}
		if err = validateEpoch(fields[1], "STATE_SET_OK.epoch"); err != nil {
			return err
		}
		_, err = positiveID(fields[2], "STATE_SET_OK.revision")
		return err

	case OpcodeStateACLSync:
		return validateStateACL(frame.Payload)

	case OpcodeStateACLOK, OpcodeEventACLOK:
		fields, err := exactTuple(frame.Payload, 2, "ACL_OK")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "ACL_OK.requestId"); err != nil {
			return err
		}
		_, err = positiveID(fields[1], "ACL_OK.policyRevision")
		return err

	case OpcodeStateResync, OpcodeCallAccepted:
		fields, err := exactTuple(frame.Payload, 1, "single-ID frame")
		if err != nil {
			return err
		}
		_, err = positiveID(fields[0], "identifier")
		return err

	case OpcodeEventSync:
		return validateEventSync(frame.Payload)

	case OpcodeEventSyncOK, OpcodeFunctionSyncOK:
		fields, err := exactTuple(frame.Payload, 2, "SYNC_OK")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "SYNC_OK.requestId"); err != nil {
			return err
		}
		return validateDictionary(fields[1], MaxDeclarations, "SYNC_OK.dictionary")

	case OpcodeTopicDict, OpcodeFunctionDict:
		fields, err := exactTuple(frame.Payload, 3, "DICTIONARY")
		if err != nil {
			return err
		}
		if err = validateEpoch(fields[0], "DICTIONARY.epoch"); err != nil {
			return err
		}
		if err = booleanValue(fields[1], "DICTIONARY.replace"); err != nil {
			return err
		}
		return validateDictionary(fields[2], MaxStatePathsPerHome, "DICTIONARY.entries")

	case OpcodeEventACLSync:
		return validateEventACL(frame.Payload)

	case OpcodeSubscribe:
		return validateSubscriptionPayload(frame.Payload, "SUBSCRIBE")
	case OpcodeSubscribeOK:
		return validateSubscriptionPayload(frame.Payload, "SUBSCRIBE_OK")
	case OpcodeUnsubscribe:
		return validateSubscriptionPayload(frame.Payload, "UNSUBSCRIBE")
	case OpcodeUnsubscribeOK:
		return validateSubscriptionPayload(frame.Payload, "UNSUBSCRIBE_OK")

	case OpcodeEvent:
		if len(frame.Payload) != 5 && len(frame.Payload) != 6 {
			return protocolError(ErrInvalidFrame, "EVENT has wrong arity")
		}
		if _, err := positiveID(frame.Payload[0], "EVENT.eventId"); err != nil {
			return err
		}
		if _, err := positiveID(frame.Payload[1], "EVENT.topicId"); err != nil {
			return err
		}
		if err := validateTarget(frame.Payload[2], frame.Payload[3], "EVENT.target"); err != nil {
			return err
		}
		if len(frame.Payload) == 6 {
			return validatePrincipal(frame.Payload[4], "EVENT.source")
		}
		return nil

	case OpcodeFunctionSync:
		fields, err := exactTuple(frame.Payload, 2, "FUNCTION_SYNC")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "FUNCTION_SYNC.requestId"); err != nil {
			return err
		}
		names, err := asArray(fields[1], "FUNCTION_SYNC.names", MaxDeclarations)
		if err != nil {
			return err
		}
		return validateUniqueStrings(names, structuredName, "FUNCTION_SYNC.names")

	case OpcodeCall:
		return validateCall(frame.Payload, false)
	case OpcodeCallDispatch:
		return validateCall(frame.Payload, true)

	case OpcodeCallResult:
		fields, err := exactTuple(frame.Payload, 3, "CALL_RESULT")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "CALL_RESULT.callId"); err != nil {
			return err
		}
		return booleanValue(fields[1], "CALL_RESULT.final")

	case OpcodeCallError:
		fields, err := exactTuple(frame.Payload, 5, "CALL_ERROR")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "CALL_ERROR.callId"); err != nil {
			return err
		}
		if _, err = callErrorCode(fields[1], "CALL_ERROR.code"); err != nil {
			return err
		}
		if err = booleanValue(fields[2], "CALL_ERROR.retryable"); err != nil {
			return err
		}
		_, err = stringValue(fields[3], 1, 256, "CALL_ERROR.message")
		return err

	case OpcodeCallCancel:
		fields, err := exactTuple(frame.Payload, 2, "CALL_CANCEL")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "CALL_CANCEL.callId"); err != nil {
			return err
		}
		_, err = integer(fields[1], 0, 0xffff, "CALL_CANCEL.reasonCode")
		return err

	case OpcodeCallCredit:
		fields, err := exactTuple(frame.Payload, 2, "CALL_CREDIT")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "CALL_CREDIT.callId"); err != nil {
			return err
		}
		_, err = integer(fields[1], 1, MaxStreamCredit, "CALL_CREDIT.additionalCredit")
		return err

	case OpcodePresenceSnapshot:
		return validatePresenceSnapshot(frame.Payload)

	case OpcodePresenceChange:
		fields, err := exactTuple(frame.Payload, 3, "PRESENCE_CHANGE")
		if err != nil {
			return err
		}
		if _, err = positiveID(fields[0], "PRESENCE_CHANGE.sessionId"); err != nil {
			return err
		}
		if _, err = opaqueID(fields[1], "PRESENCE_CHANGE.userId"); err != nil {
			return err
		}
		_, err = integer(fields[2], 1, 2, "PRESENCE_CHANGE.event")
		return err
	}
	return protocolError(ErrUnknownOpcode, "unknown core opcode")
}

func validateStateACL(payload []any) error {
	fields, err := exactTuple(payload, 2, "STATE_ACL_SYNC")
	if err != nil {
		return err
	}
	if _, err = positiveID(fields[0], "STATE_ACL_SYNC.requestId"); err != nil {
		return err
	}
	entries, err := asArray(fields[1], "STATE_ACL_SYNC.declarations", MaxDeclarations)
	if err != nil {
		return err
	}
	users := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		item, tupleErr := exactTuple(entry, 2, "STATE_ACL_SYNC.declaration")
		if tupleErr != nil {
			return tupleErr
		}
		user, userErr := opaqueID(item[0], "STATE_ACL_SYNC.userId")
		if userErr != nil {
			return userErr
		}
		if _, exists := users[user]; exists {
			return protocolError(ErrInvalidFrame, "STATE_ACL_SYNC contains a duplicate user")
		}
		users[user] = struct{}{}
		if err = validatePatterns(item[1], "STATE_ACL_SYNC.patterns"); err != nil {
			return err
		}
	}
	return nil
}

func validateEventSync(payload []any) error {
	fields, err := exactTuple(payload, 2, "EVENT_SYNC")
	if err != nil {
		return err
	}
	if _, err = positiveID(fields[0], "EVENT_SYNC.requestId"); err != nil {
		return err
	}
	entries, err := asArray(fields[1], "EVENT_SYNC.declarations", MaxDeclarations)
	if err != nil {
		return err
	}
	topics := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		item, tupleErr := exactTuple(entry, 2, "EVENT_SYNC.declaration")
		if tupleErr != nil {
			return tupleErr
		}
		topic, nameErr := structuredName(item[0], "EVENT_SYNC.topic")
		if nameErr != nil {
			return nameErr
		}
		if _, exists := topics[topic]; exists {
			return protocolError(ErrInvalidFrame, "EVENT_SYNC contains a duplicate topic")
		}
		topics[topic] = struct{}{}
		if _, err = integer(item[1], 1, 0x0f, "EVENT_SYNC.flags"); err != nil {
			return err
		}
	}
	return nil
}

func validateEventACL(payload []any) error {
	fields, err := exactTuple(payload, 2, "EVENT_ACL_SYNC")
	if err != nil {
		return err
	}
	if _, err = positiveID(fields[0], "EVENT_ACL_SYNC.requestId"); err != nil {
		return err
	}
	entries, err := asArray(fields[1], "EVENT_ACL_SYNC.declarations", MaxDeclarations)
	if err != nil {
		return err
	}
	users := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		item, tupleErr := exactTuple(entry, 3, "EVENT_ACL_SYNC.declaration")
		if tupleErr != nil {
			return tupleErr
		}
		user, userErr := opaqueID(item[0], "EVENT_ACL_SYNC.userId")
		if userErr != nil {
			return userErr
		}
		if _, exists := users[user]; exists {
			return protocolError(ErrInvalidFrame, "EVENT_ACL_SYNC contains a duplicate user")
		}
		users[user] = struct{}{}
		if err = validatePatterns(item[1], "EVENT_ACL_SYNC.publishPatterns"); err != nil {
			return err
		}
		if err = validatePatterns(item[2], "EVENT_ACL_SYNC.subscribePatterns"); err != nil {
			return err
		}
	}
	return nil
}

func validateCall(payload []any, dispatched bool) error {
	expected := 8
	label := "CALL"
	if dispatched {
		expected = 9
		label = "CALL_DISPATCH"
	}
	fields, err := exactTuple(payload, expected, label)
	if err != nil {
		return err
	}
	if _, err = positiveID(fields[0], label+".callId"); err != nil {
		return err
	}
	offset := 0
	if dispatched {
		if err = validatePrincipal(fields[1], label+".source"); err != nil {
			return err
		}
		offset = 1
	}
	if err = validateTarget(fields[1+offset], fields[2+offset], label+".target"); err != nil {
		return err
	}
	if _, err = positiveID(fields[3+offset], label+".functionId"); err != nil {
		return err
	}
	if _, err = integer(fields[4+offset], 1, MaxCallTimeoutMS, label+".timeoutMs"); err != nil {
		return err
	}
	if err = nullableString(fields[5+offset], 128, label+".idempotencyKey"); err != nil {
		return err
	}
	_, err = integer(fields[6+offset], 0, MaxStreamCredit, label+".initialCredit")
	return err
}

func validatePresenceSnapshot(payload []any) error {
	fields, err := exactTuple(payload, 1, "PRESENCE_SNAPSHOT")
	if err != nil {
		return err
	}
	entries, err := asArray(fields[0], "PRESENCE_SNAPSHOT.entries", MaxArrayItems)
	if err != nil {
		return err
	}
	sessions := make(map[int64]struct{}, len(entries))
	for _, entry := range entries {
		item, tupleErr := exactTuple(entry, 2, "PRESENCE_SNAPSHOT.entry")
		if tupleErr != nil {
			return tupleErr
		}
		session, idErr := positiveID(item[0], "PRESENCE_SNAPSHOT.sessionId")
		if idErr != nil {
			return idErr
		}
		if _, exists := sessions[session]; exists {
			return protocolError(ErrInvalidFrame, "PRESENCE_SNAPSHOT contains a duplicate session")
		}
		sessions[session] = struct{}{}
		if _, err = opaqueID(item[1], "PRESENCE_SNAPSHOT.userId"); err != nil {
			return err
		}
	}
	return nil
}

func preflight(input []byte) error {
	if len(input) > MaxFrameBytes {
		return protocolError(ErrFrameTooLarge, "frame exceeds byte limit")
	}
	if len(input) < 2 {
		return protocolError(ErrMalformed, "frame is missing its payload")
	}
	result, err := scanValue(input, 1, 1, &scanState{})
	if err != nil {
		return err
	}
	if result.kind != kindArray {
		return protocolError(ErrInvalidFrame, "frame payload must be an array")
	}
	if result.end != len(input) {
		return protocolError(ErrMalformed, "frame has trailing bytes")
	}
	return nil
}

func EncodeFrame(frame Frame) ([]byte, error) {
	if err := validateFrame(frame); err != nil {
		return nil, err
	}
	payload, err := encodeValue(frame.Payload, 1, &scanState{})
	if err != nil {
		return nil, err
	}
	output := make([]byte, 1, len(payload)+1)
	output[0] = frame.Opcode
	output = append(output, payload...)
	if err = preflight(output); err != nil {
		return nil, err
	}
	return output, nil
}

func DecodeFrame(input []byte) (Frame, error) {
	if err := preflight(input); err != nil {
		return Frame{}, err
	}
	opcode := input[0]
	if opcode < 0x80 && !knownCoreOpcode(opcode) {
		return Frame{}, protocolError(ErrUnknownOpcode, "unknown core opcode 0x%x", opcode)
	}
	decoded, err := decodeCanonicalPayload(input[1:])
	if err != nil {
		return Frame{}, protocolError(ErrMalformed, "decoder rejected a preflighted payload: %v", err)
	}
	payload, ok := decoded.([]any)
	if !ok {
		return Frame{}, protocolError(ErrInvalidFrame, "frame payload must be an array")
	}
	frame := Frame{Opcode: opcode, Payload: payload}
	if err = validateFrame(frame); err != nil {
		return Frame{}, err
	}
	return frame, nil
}
