import { describe, expect, it } from 'vitest'
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  importEcdhKeyPair,
  generateVapidKeys,
  sendWebPush,
  vapidAuthorization,
} from './webpush.ts'

// RFC 8291, Appendix A: the worked example with fixed keys and salt.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

/** The user agent's side of RFC 8291, written out separately to check our sender against. */
async function decrypt(body: Uint8Array, uaPublic: string, uaPrivate: string, auth: string) {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idLen = body[20]!
  const asPublic = body.slice(21, 21 + idLen)
  const ciphertext = body.slice(21 + idLen)
  const ua = await importEcdhKeyPair(uaPublic, uaPrivate)
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256)
  const derive = async (
    s: Uint8Array,
    ikm: ArrayBuffer | Uint8Array,
    info: Uint8Array,
    n: number,
  ) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: s as BufferSource, info: info as BufferSource },
        await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    )
  const enc = new TextEncoder()
  const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...ua.publicKey, ...asPublic])
  const ikm = await derive(base64UrlDecode(auth), secret, keyInfo, 32)
  const cek = await derive(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await derive(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  )
  // Strip the padding: trailing zeros, then the 0x02 last-record delimiter.
  let end = padded.length - 1
  while (padded[end] === 0) end--
  expect(padded[end]).toBe(2)
  return { rs, text: new TextDecoder().decode(padded.slice(0, end)) }
}

describe('base64url', () => {
  it('round-trips without padding', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 1])
    expect(base64UrlEncode(bytes)).toBe('AP8-PwE')
    expect([...base64UrlDecode('AP8-PwE')]).toEqual([...bytes])
  })
})

describe('encryptPayload (RFC 8291)', () => {
  it('matches the RFC test vector', async () => {
    const body = await encryptPayload(
      RFC.plaintext,
      { p256dh: RFC.uaPublic, auth: RFC.authSecret },
      {
        salt: base64UrlDecode(RFC.salt),
        serverKeys: await importEcdhKeyPair(RFC.asPublic, RFC.asPrivate),
      },
    )
    expect(base64UrlEncode(body)).toBe(RFC.body)
  })

  it('round-trips with a fresh browser key pair and random salt', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair
    const uaPublic = base64UrlEncode(
      new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)),
    )
    const uaPrivate = (await crypto.subtle.exportKey('jwk', ua.privateKey)).d!
    const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
    const message = JSON.stringify({ title: 'Price dropped', body: 'Mokotów: 4 950 zł → 4 700 zł' })

    const body = await encryptPayload(message, { p256dh: uaPublic, auth })
    const again = await encryptPayload(message, { p256dh: uaPublic, auth })
    expect(base64UrlEncode(body)).not.toBe(base64UrlEncode(again))
    expect(await decrypt(body, uaPublic, uaPrivate, auth)).toEqual({ rs: 4096, text: message })
  })

  it('refuses payloads that do not fit in one record', async () => {
    await expect(
      encryptPayload('x'.repeat(4000), { p256dh: RFC.uaPublic, auth: RFC.authSecret }),
    ).rejects.toThrow(/too large/)
  })
})

describe('vapidAuthorization (RFC 8292)', () => {
  it('signs an ES256 JWT for the endpoint origin', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKey = base64UrlEncode(
      new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    )
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!

    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc:def',
      { publicKey, privateKey, subject: 'mailto:owner@example.com' },
      1_800_000_000,
    )
    const match = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/)
    expect(match).not.toBeNull()
    const [, head, claims, signature, k] = match!
    expect(k).toBe(publicKey)
    const decode = (s: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(s)))
    expect(decode(head!)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decode(claims!)).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_800_000_000 + 12 * 3600,
      sub: 'mailto:owner@example.com',
    })
    const sig = base64UrlDecode(signature!)
    expect(sig.length).toBe(64)
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      sig,
      new TextEncoder().encode(`${head}.${claims}`),
    )
    expect(valid).toBe(true)
  })
})

describe('sendWebPush', () => {
  it('posts the encrypted body with the protocol headers', async () => {
    const vapid = await generateVapidKeys('mailto:test@example.com')
    const requests: { url: string; init: RequestInit }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch

    const status = await sendWebPush(
      { endpoint: 'https://push.example.net/sub/1', p256dh: RFC.uaPublic, auth: RFC.authSecret },
      '{"title":"hi"}',
      vapid,
      { fetch: fakeFetch, urgency: 'high' },
    )
    expect(status).toBe(201)
    const headers = requests[0]!.init.headers as Record<string, string>
    expect(requests[0]!.url).toBe('https://push.example.net/sub/1')
    expect(headers['Content-Encoding']).toBe('aes128gcm')
    expect(headers.TTL).toBe('86400')
    expect(headers.Urgency).toBe('high')
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/)
    const body = requests[0]!.init.body as Uint8Array
    expect((await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.authSecret)).text).toBe(
      '{"title":"hi"}',
    )
  })
})
