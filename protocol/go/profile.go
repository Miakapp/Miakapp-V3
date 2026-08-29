package protocol

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"unicode/utf8"

	"github.com/vmihailenco/msgpack/v5"
)

const (
	MaxFrameBytes  = 262_144
	MaxDepth       = 16
	MaxValues      = 16_384
	MaxStringBytes = 65_536
	MaxBinaryBytes = 131_072
	MaxArrayItems  = 4_096
	MaxMapEntries  = 4_096
	MaxMapKeyBytes = 256

	maxSafeInteger int64 = 9_007_199_254_740_991
	minSafeInteger int64 = -9_007_199_254_740_991
)

type ErrorKind string

const (
	ErrMalformed     ErrorKind = "malformed"
	ErrNonCanonical  ErrorKind = "non_canonical"
	ErrInvalidValue  ErrorKind = "invalid_value"
	ErrLimit         ErrorKind = "limit"
	ErrUnknownOpcode ErrorKind = "unknown_opcode"
	ErrInvalidFrame  ErrorKind = "invalid_frame"
	ErrFrameTooLarge ErrorKind = "frame_too_large"
)

type ProtocolError struct {
	Kind    ErrorKind
	Message string
}

func (e *ProtocolError) Error() string {
	return fmt.Sprintf("%s: %s", e.Kind, e.Message)
}

func protocolError(kind ErrorKind, format string, values ...any) error {
	return &ProtocolError{Kind: kind, Message: fmt.Sprintf(format, values...)}
}

type valueKind uint8

const (
	kindNull valueKind = iota
	kindBoolean
	kindInteger
	kindFloat
	kindString
	kindBinary
	kindArray
	kindMap
)

type scanState struct {
	nodes        int
	encodedBytes int
}

func accountEncodedBytes(state *scanState, length int) error {
	state.encodedBytes += length
	if state.encodedBytes > MaxFrameBytes-1 {
		return protocolError(ErrFrameTooLarge, "encoded frame exceeds byte limit")
	}
	return nil
}

func encodedAtom(state *scanState, value []byte) ([]byte, error) {
	if err := accountEncodedBytes(state, len(value)); err != nil {
		return nil, err
	}
	return value, nil
}

type scanResult struct {
	end         int
	kind        valueKind
	stringBytes []byte
	stringValue string
}

func ensureAvailable(input []byte, offset, length int) error {
	if offset < 0 || length < 0 || offset > len(input)-length {
		return protocolError(ErrMalformed, "truncated MessagePack value")
	}
	return nil
}

func readUint16(input []byte, offset int) (uint16, error) {
	if err := ensureAvailable(input, offset, 2); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint16(input[offset : offset+2]), nil
}

func readUint32(input []byte, offset int) (uint32, error) {
	if err := ensureAvailable(input, offset, 4); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint32(input[offset : offset+4]), nil
}

func readUint64(input []byte, offset int) (uint64, error) {
	if err := ensureAvailable(input, offset, 8); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint64(input[offset : offset+8]), nil
}

func scanString(input []byte, start, length, next int) (scanResult, error) {
	if length > MaxStringBytes {
		return scanResult{}, protocolError(ErrLimit, "string length exceeds limit")
	}
	if err := ensureAvailable(input, start, length); err != nil {
		return scanResult{}, err
	}
	value := input[start : start+length]
	if !utf8.Valid(value) {
		return scanResult{}, protocolError(ErrInvalidValue, "string is not valid UTF-8")
	}
	return scanResult{
		end:         next + length,
		kind:        kindString,
		stringBytes: value,
		stringValue: string(value),
	}, nil
}

func scanBinary(input []byte, start, length, next int) (scanResult, error) {
	if length > MaxBinaryBytes {
		return scanResult{}, protocolError(ErrLimit, "binary length exceeds limit")
	}
	if err := ensureAvailable(input, start, length); err != nil {
		return scanResult{}, err
	}
	return scanResult{end: next + length, kind: kindBinary}, nil
}

func scanArray(input []byte, offset, length, depth int, state *scanState) (scanResult, error) {
	if length > MaxArrayItems {
		return scanResult{}, protocolError(ErrLimit, "array length exceeds limit")
	}
	cursor := offset
	for index := 0; index < length; index++ {
		item, err := scanValue(input, cursor, depth+1, state)
		if err != nil {
			return scanResult{}, err
		}
		cursor = item.end
	}
	return scanResult{end: cursor, kind: kindArray}, nil
}

func scanMap(input []byte, offset, length, depth int, state *scanState) (scanResult, error) {
	if length > MaxMapEntries {
		return scanResult{}, protocolError(ErrLimit, "map length exceeds limit")
	}
	cursor := offset
	var previous []byte
	for index := 0; index < length; index++ {
		key, err := scanValue(input, cursor, depth+1, state)
		if err != nil {
			return scanResult{}, err
		}
		if key.kind != kindString {
			return scanResult{}, protocolError(ErrInvalidValue, "map keys must be strings")
		}
		if len(key.stringBytes) > MaxMapKeyBytes {
			return scanResult{}, protocolError(ErrLimit, "map key exceeds limit")
		}
		if key.stringValue == "__proto__" {
			return scanResult{}, protocolError(ErrInvalidValue, "reserved map key")
		}
		if previous != nil {
			order := bytes.Compare(previous, key.stringBytes)
			if order == 0 {
				return scanResult{}, protocolError(ErrInvalidValue, "duplicate map key")
			}
			if order > 0 {
				return scanResult{}, protocolError(ErrNonCanonical, "map keys are not in UTF-8 byte order")
			}
		}
		previous = key.stringBytes
		item, err := scanValue(input, key.end, depth+1, state)
		if err != nil {
			return scanResult{}, err
		}
		cursor = item.end
	}
	return scanResult{end: cursor, kind: kindMap}, nil
}

func scanValue(input []byte, offset, depth int, state *scanState) (scanResult, error) {
	if depth > MaxDepth {
		return scanResult{}, protocolError(ErrLimit, "value nesting exceeds limit")
	}
	state.nodes++
	if state.nodes > MaxValues {
		return scanResult{}, protocolError(ErrLimit, "payload value count exceeds limit")
	}
	if err := ensureAvailable(input, offset, 1); err != nil {
		return scanResult{}, err
	}
	marker := input[offset]
	next := offset + 1

	if marker <= 0x7f || marker >= 0xe0 {
		return scanResult{end: next, kind: kindInteger}, nil
	}
	if marker >= 0x80 && marker <= 0x8f {
		return scanMap(input, next, int(marker&0x0f), depth, state)
	}
	if marker >= 0x90 && marker <= 0x9f {
		return scanArray(input, next, int(marker&0x0f), depth, state)
	}
	if marker >= 0xa0 && marker <= 0xbf {
		return scanString(input, next, int(marker&0x1f), next)
	}

	switch marker {
	case 0xc0:
		return scanResult{end: next, kind: kindNull}, nil
	case 0xc1:
		return scanResult{}, protocolError(ErrMalformed, "reserved MessagePack marker")
	case 0xc2, 0xc3:
		return scanResult{end: next, kind: kindBoolean}, nil
	case 0xc4:
		if err := ensureAvailable(input, next, 1); err != nil {
			return scanResult{}, err
		}
		return scanBinary(input, next+1, int(input[next]), next+1)
	case 0xc5:
		length, err := readUint16(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if length <= 0xff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest binary length")
		}
		return scanBinary(input, next+2, int(length), next+2)
	case 0xc6:
		length, err := readUint32(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if length <= 0xffff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest binary length")
		}
		if uint64(length) > uint64(MaxBinaryBytes) {
			return scanResult{}, protocolError(ErrLimit, "binary length exceeds limit")
		}
		return scanBinary(input, next+4, int(length), next+4)
	case 0xca:
		if err := ensureAvailable(input, next, 4); err != nil {
			return scanResult{}, err
		}
		return scanResult{}, protocolError(ErrNonCanonical, "float32 is forbidden")
	case 0xcb:
		bits, err := readUint64(input, next)
		if err != nil {
			return scanResult{}, err
		}
		value := math.Float64frombits(bits)
		if math.IsNaN(value) || math.IsInf(value, 0) || (value == 0 && math.Signbit(value)) {
			return scanResult{}, protocolError(ErrInvalidValue, "non-finite and negative-zero floats are forbidden")
		}
		if math.Trunc(value) == value {
			if value >= float64(minSafeInteger) && value <= float64(maxSafeInteger) {
				return scanResult{}, protocolError(ErrNonCanonical, "integral float must be an integer")
			}
			return scanResult{}, protocolError(ErrInvalidValue, "integral float exceeds the safe-integer range")
		}
		return scanResult{end: next + 8, kind: kindFloat}, nil
	case 0xcc:
		if err := ensureAvailable(input, next, 1); err != nil {
			return scanResult{}, err
		}
		if input[next] <= 0x7f {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest unsigned integer")
		}
		return scanResult{end: next + 1, kind: kindInteger}, nil
	case 0xcd:
		value, err := readUint16(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if value <= 0xff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest unsigned integer")
		}
		return scanResult{end: next + 2, kind: kindInteger}, nil
	case 0xce:
		value, err := readUint32(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if value <= 0xffff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest unsigned integer")
		}
		return scanResult{end: next + 4, kind: kindInteger}, nil
	case 0xcf:
		value, err := readUint64(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if value <= 0xffff_ffff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest unsigned integer")
		}
		if value > uint64(maxSafeInteger) {
			return scanResult{}, protocolError(ErrInvalidValue, "integer exceeds safe range")
		}
		return scanResult{end: next + 8, kind: kindInteger}, nil
	case 0xd0:
		if err := ensureAvailable(input, next, 1); err != nil {
			return scanResult{}, err
		}
		value := int8(input[next])
		if value >= -32 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest signed integer")
		}
		return scanResult{end: next + 1, kind: kindInteger}, nil
	case 0xd1:
		value, err := readUint16(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if int16(value) >= -128 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest signed integer")
		}
		return scanResult{end: next + 2, kind: kindInteger}, nil
	case 0xd2:
		value, err := readUint32(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if int32(value) >= -32_768 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest signed integer")
		}
		return scanResult{end: next + 4, kind: kindInteger}, nil
	case 0xd3:
		value, err := readUint64(input, next)
		if err != nil {
			return scanResult{}, err
		}
		signed := int64(value)
		if signed >= -2_147_483_648 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest signed integer")
		}
		if signed < minSafeInteger {
			return scanResult{}, protocolError(ErrInvalidValue, "integer exceeds safe range")
		}
		return scanResult{end: next + 8, kind: kindInteger}, nil
	case 0xd9:
		if err := ensureAvailable(input, next, 1); err != nil {
			return scanResult{}, err
		}
		length := int(input[next])
		if length <= 31 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest string length")
		}
		return scanString(input, next+1, length, next+1)
	case 0xda:
		length, err := readUint16(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if length <= 0xff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest string length")
		}
		return scanString(input, next+2, int(length), next+2)
	case 0xdb:
		length, err := readUint32(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if length <= 0xffff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest string length")
		}
		if uint64(length) > uint64(MaxStringBytes) {
			return scanResult{}, protocolError(ErrLimit, "string length exceeds limit")
		}
		return scanString(input, next+4, int(length), next+4)
	case 0xdc:
		length, err := readUint16(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if length <= 15 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest array length")
		}
		return scanArray(input, next+2, int(length), depth, state)
	case 0xdd:
		length, err := readUint32(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if uint64(length) > uint64(MaxArrayItems) {
			return scanResult{}, protocolError(ErrLimit, "array length exceeds limit")
		}
		if length <= 0xffff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest array length")
		}
		return scanArray(input, next+4, int(length), depth, state)
	case 0xde:
		length, err := readUint16(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if length <= 15 {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest map length")
		}
		return scanMap(input, next+2, int(length), depth, state)
	case 0xdf:
		length, err := readUint32(input, next)
		if err != nil {
			return scanResult{}, err
		}
		if uint64(length) > uint64(MaxMapEntries) {
			return scanResult{}, protocolError(ErrLimit, "map length exceeds limit")
		}
		if length <= 0xffff {
			return scanResult{}, protocolError(ErrNonCanonical, "non-shortest map length")
		}
		return scanMap(input, next+4, int(length), depth, state)
	default:
		if (marker >= 0xc7 && marker <= 0xc9) || (marker >= 0xd4 && marker <= 0xd8) {
			return scanResult{}, protocolError(ErrInvalidValue, "MessagePack extensions are forbidden")
		}
		return scanResult{}, protocolError(ErrMalformed, "unsupported MessagePack marker 0x%x", marker)
	}
}

func appendUint16(output []byte, value uint16) []byte {
	return binary.BigEndian.AppendUint16(output, value)
}

func appendUint32(output []byte, value uint32) []byte {
	return binary.BigEndian.AppendUint32(output, value)
}

func appendUint64(output []byte, value uint64) []byte {
	return binary.BigEndian.AppendUint64(output, value)
}

func encodeSignedInteger(value int64) []byte {
	if value >= 0 {
		return encodeUnsignedInteger(uint64(value))
	}
	if value >= -32 {
		return []byte{byte(int16(256) + int16(value))}
	}
	if value >= -128 {
		return []byte{0xd0, byte(int8(value))}
	}
	if value >= -32_768 {
		return appendUint16([]byte{0xd1}, uint16(int16(value)))
	}
	if value >= -2_147_483_648 {
		return appendUint32([]byte{0xd2}, uint32(int32(value)))
	}
	return appendUint64([]byte{0xd3}, uint64(value))
}

func encodeUnsignedInteger(value uint64) []byte {
	if value <= 0x7f {
		return []byte{byte(value)}
	}
	if value <= 0xff {
		return []byte{0xcc, byte(value)}
	}
	if value <= 0xffff {
		return appendUint16([]byte{0xcd}, uint16(value))
	}
	if value <= 0xffff_ffff {
		return appendUint32([]byte{0xce}, uint32(value))
	}
	return appendUint64([]byte{0xcf}, value)
}

func encodeLength(length, fixedBase, fixedMaximum int, marker8 int, marker16, marker32 byte) []byte {
	if length <= fixedMaximum {
		return []byte{byte(fixedBase + length)}
	}
	if marker8 >= 0 && length <= 0xff {
		return []byte{byte(marker8), byte(length)}
	}
	if length <= 0xffff {
		return appendUint16([]byte{marker16}, uint16(length))
	}
	return appendUint32([]byte{marker32}, uint32(length))
}

func integerParts(value any) (signed int64, unsigned uint64, isUnsigned bool, ok bool) {
	switch number := value.(type) {
	case int:
		return int64(number), 0, false, true
	case int8:
		return int64(number), 0, false, true
	case int16:
		return int64(number), 0, false, true
	case int32:
		return int64(number), 0, false, true
	case int64:
		return number, 0, false, true
	case uint:
		return 0, uint64(number), true, true
	case uint8:
		return 0, uint64(number), true, true
	case uint16:
		return 0, uint64(number), true, true
	case uint32:
		return 0, uint64(number), true, true
	case uint64:
		return 0, number, true, true
	}
	return 0, 0, false, false
}

func encodeValue(value any, depth int, state *scanState) ([]byte, error) {
	if depth > MaxDepth {
		return nil, protocolError(ErrLimit, "value nesting exceeds limit")
	}
	state.nodes++
	if state.nodes > MaxValues {
		return nil, protocolError(ErrLimit, "payload value count exceeds limit")
	}

	if value == nil {
		return encodedAtom(state, []byte{0xc0})
	}
	if number, ok := value.(bool); ok {
		if number {
			return encodedAtom(state, []byte{0xc3})
		}
		return encodedAtom(state, []byte{0xc2})
	}
	if signed, unsigned, isUnsigned, ok := integerParts(value); ok {
		if isUnsigned {
			if unsigned > uint64(maxSafeInteger) {
				return nil, protocolError(ErrInvalidValue, "integer exceeds safe range")
			}
			return encodedAtom(state, encodeUnsignedInteger(unsigned))
		}
		if signed < minSafeInteger || signed > maxSafeInteger {
			return nil, protocolError(ErrInvalidValue, "integer exceeds safe range")
		}
		return encodedAtom(state, encodeSignedInteger(signed))
	}
	if floating, ok := value.(float32); ok {
		encoded, err := encodeFloat(float64(floating))
		if err != nil {
			return nil, err
		}
		return encodedAtom(state, encoded)
	}
	if floating, ok := value.(float64); ok {
		encoded, err := encodeFloat(floating)
		if err != nil {
			return nil, err
		}
		return encodedAtom(state, encoded)
	}
	if text, ok := value.(string); ok {
		if !utf8.ValidString(text) {
			return nil, protocolError(ErrInvalidValue, "string is not valid UTF-8")
		}
		if len(text) > MaxStringBytes {
			return nil, protocolError(ErrLimit, "string length exceeds limit")
		}
		prefix := encodeLength(len(text), 0xa0, 31, 0xd9, 0xda, 0xdb)
		if err := accountEncodedBytes(state, len(prefix)+len(text)); err != nil {
			return nil, err
		}
		return append(prefix, []byte(text)...), nil
	}
	if binaryValue, ok := value.([]byte); ok {
		if len(binaryValue) > MaxBinaryBytes {
			return nil, protocolError(ErrLimit, "binary length exceeds limit")
		}
		prefix := encodeLength(len(binaryValue), 0, -1, 0xc4, 0xc5, 0xc6)
		if err := accountEncodedBytes(state, len(prefix)+len(binaryValue)); err != nil {
			return nil, err
		}
		return append(prefix, binaryValue...), nil
	}
	if array, ok := value.([]any); ok {
		if len(array) > MaxArrayItems {
			return nil, protocolError(ErrLimit, "array length exceeds limit")
		}
		output := encodeLength(len(array), 0x90, 15, -1, 0xdc, 0xdd)
		if err := accountEncodedBytes(state, len(output)); err != nil {
			return nil, err
		}
		for _, item := range array {
			encoded, err := encodeValue(item, depth+1, state)
			if err != nil {
				return nil, err
			}
			output = append(output, encoded...)
		}
		return output, nil
	}
	if object, ok := value.(map[string]any); ok {
		if len(object) > MaxMapEntries {
			return nil, protocolError(ErrLimit, "map length exceeds limit")
		}
		keys := make([]string, 0, len(object))
		for key := range object {
			if !utf8.ValidString(key) {
				return nil, protocolError(ErrInvalidValue, "map key is not valid UTF-8")
			}
			if len(key) > MaxMapKeyBytes {
				return nil, protocolError(ErrLimit, "map key exceeds limit")
			}
			if key == "__proto__" {
				return nil, protocolError(ErrInvalidValue, "reserved map key")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(left, right int) bool {
			return bytes.Compare([]byte(keys[left]), []byte(keys[right])) < 0
		})
		output := encodeLength(len(keys), 0x80, 15, -1, 0xde, 0xdf)
		if err := accountEncodedBytes(state, len(output)); err != nil {
			return nil, err
		}
		for _, key := range keys {
			encodedKey, err := encodeValue(key, depth+1, state)
			if err != nil {
				return nil, err
			}
			encodedValue, err := encodeValue(object[key], depth+1, state)
			if err != nil {
				return nil, err
			}
			output = append(output, encodedKey...)
			output = append(output, encodedValue...)
		}
		return output, nil
	}
	return nil, protocolError(ErrInvalidValue, "unsupported protocol value %T", value)
}

func encodeFloat(value float64) ([]byte, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) || (value == 0 && math.Signbit(value)) {
		return nil, protocolError(ErrInvalidValue, "non-finite and negative-zero numbers are forbidden")
	}
	if math.Trunc(value) == value {
		if value >= float64(minSafeInteger) && value <= float64(maxSafeInteger) {
			return encodeSignedInteger(int64(value)), nil
		}
		return nil, protocolError(ErrInvalidValue, "integral float exceeds the safe-integer range")
	}
	return appendUint64([]byte{0xcb}, math.Float64bits(value)), nil
}

func decodeMap(decoder *msgpack.Decoder) (any, error) {
	length, err := decoder.DecodeMapLen()
	if err != nil {
		return nil, err
	}
	object := make(map[string]any, length)
	for index := 0; index < length; index++ {
		key, err := decoder.DecodeString()
		if err != nil {
			return nil, err
		}
		value, err := decoder.DecodeInterface()
		if err != nil {
			return nil, err
		}
		object[key] = value
	}
	return object, nil
}

func decodeCanonicalPayload(input []byte) (any, error) {
	decoder := msgpack.NewDecoder(bytes.NewReader(input))
	decoder.SetMapDecoder(decodeMap)
	decoded, err := decoder.DecodeInterface()
	if err != nil {
		return nil, err
	}
	return normalizeDecodedValue(decoded), nil
}

func normalizeDecodedValue(value any) any {
	switch typed := value.(type) {
	case int8:
		return int64(typed)
	case int16:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case uint8:
		return int64(typed)
	case uint16:
		return int64(typed)
	case uint32:
		return int64(typed)
	case uint64:
		return int64(typed)
	case []any:
		for index, child := range typed {
			typed[index] = normalizeDecodedValue(child)
		}
		return typed
	case map[string]any:
		for key, child := range typed {
			typed[key] = normalizeDecodedValue(child)
		}
		return typed
	default:
		return value
	}
}
