export const BLOCKED_WORKER_GLOBALS = Object.freeze([
  'fetch',
  'WebSocket',
  'WebSocketStream',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  'XMLHttpRequest',
  'RTCPeerConnection',
  'WebTransport',
] as const);

export const BLOCKED_NAVIGATOR_MEMBERS = Object.freeze([
  'serviceWorker',
  'sendBeacon',
] as const);

export const SANDBOX_DENY_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "script-src-attr 'none'",
  "style-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
] as const);

export const SANDBOX_DISABLED_FEATURES = Object.freeze([
  'camera',
  'microphone',
  'geolocation',
  'display-capture',
  'fullscreen',
  'payment',
  'usb',
  'serial',
  'hid',
  'bluetooth',
  'clipboard-read',
  'clipboard-write',
] as const);
