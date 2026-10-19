// The Web Push protocol with WebCrypto only, so it bundles for Deno (no npm:web-push):
//   - RFC 8291 message encryption with the aes128gcm content coding (RFC 8188)
//   - RFC 8292 VAPID: an ES256 JWT in the Authorization header
// Keys use the formats `npx web-push generate-vapid-keys` prints and browsers
// return from PushSubscription.toJSON(): base64url, public keys as uncompressed
// P-256 points (65 bytes), the private key as the raw 32-byte scalar.

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** "mailto:you@example.com" or an https URL: who the push service can contact. */
  subject: string
}

type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()
// One record holds the whole message; push services accept up to 4096 bytes.
const RECORD_SIZE = 4096

export function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(text: string): Bytes {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** A P-256 key from raw base64url parts, as JWK (WebCrypto can't import a raw private scalar). */
function p256Jwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('Expected an uncompressed P-256 public key (65 bytes)')
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKey.subarray(1, 33)),
    y: base64UrlEncode(publicKey.subarray(33, 65)),
    ...(privateKey ? { d: base64UrlEncode(privateKey) } : {}),
  }
}

export interface EcdhKeyPair {
  publicKey: Bytes
  privateKey: CryptoKey
}

export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { publicKey, privateKey: pair.privateKey }
}

/** Imports a known ECDH key pair, e.g. the RFC 8291 test vector's. */
export async function importEcdhKeyPair(publicKey: string, privateKey: string) {
  const pub = base64UrlDecode(publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    p256Jwk(pub, base64UrlDecode(privateKey)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  return { publicKey: pub, privateKey: key }
}

/** A new VAPID key pair, in the same format as `npx web-push generate-vapid-keys`. */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: base64UrlEncode(publicKey), privateKey: d!, subject }
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

export interface EncryptOptions {
  /** Fixed values for test vectors; random by default. */
  salt?: Bytes
  serverKeys?: EcdhKeyPair
}

/** RFC 8291: encrypts `plaintext` for one subscription. Returns the aes128gcm request body. */
export async function encryptPayload(
  plaintext: string | Uint8Array,
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  options: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = base64UrlDecode(subscription.p256dh)
  const authSecret = base64UrlDecode(subscription.auth)
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const server = options.serverKeys ?? (await generateEcdhKeyPair())

  const uaKey = await crypto.subtle.importKey(
    'jwk',
    p256Jwk(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256),
  )

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, server.publicKey)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)

  const data = typeof plaintext === 'string' ? encoder.encode(plaintext) : plaintext
  // A single, last record: the data followed by the 0x02 delimiter, no padding.
  const padded = concat(data, new Uint8Array([2]))
  if (padded.length + 16 > RECORD_SIZE - 86) throw new Error('Push payload is too large')
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded),
  )

  // Header: salt (16) || record size (uint32 BE) || key id length (1) || key id (as_public)
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = server.publicKey.length
  return concat(header, server.publicKey, ciphertext)
}

/** RFC 8292: the `Authorization: vapid t=<jwt>, k=<public key>` header for an endpoint. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const publicKey = base64UrlDecode(vapid.publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    p256Jwk(publicKey, base64UrlDecode(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const segment = (value: object) => base64UrlEncode(encoder.encode(JSON.stringify(value)))
  const unsigned = `${segment({ typ: 'JWT', alg: 'ES256' })}.${segment({
    aud: new URL(endpoint).origin,
    // At most 24 hours ahead (RFC 8292); 12 leaves room for clock skew.
    exp: nowSeconds + 12 * 3600,
    sub: vapid.subject,
  })}`
  // WebCrypto signs ECDSA as raw r || s, which is what JWS ES256 wants.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)),
  )
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`
}

export interface SendOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  /** Replaces an undelivered message with the same topic (max 32 base64url chars). */
  topic?: string
  fetch?: typeof fetch
}

/** Sends one encrypted message. Returns the push service's HTTP status (201 = accepted). */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  options: SendOptions = {},
): Promise<number> {
  const body = await encryptPayload(payload, subscription)
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttl ?? 24 * 3600),
    Urgency: options.urgency ?? 'normal',
  }
  if (options.topic) headers.Topic = options.topic
  const res = await (options.fetch ?? fetch)(subscription.endpoint, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  })
  await res.body?.cancel()
  return res.status
}
