// Minimal AWS Signature Version 4 signer, enough for SESv2 JSON POSTs.
//
// Hand-rolled against node:crypto rather than pulling in @aws-sdk/client-sesv2,
// which would add a large dependency tree for one provider. Scope is deliberately
// narrow: single-region, POST-only, no session tokens beyond the optional header,
// no chunked/streaming payloads.
//
// Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv4-signing-examples.html

import crypto from 'crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * Timestamps in the two formats SigV4 needs: `20130524T000000Z` and `20130524`.
 * Split out so tests can pin a known instant.
 */
export function sigv4Timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

/**
 * The four-step HMAC chain that turns a secret access key into a signing key.
 * Exported so it can be checked against AWS's published derivation vector —
 * this chain is where signing bugs hide, and they surface only as opaque 403s.
 */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

export interface Sigv4Input {
  method: string
  host: string
  path: string
  region: string
  service: string
  body: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** Injectable for deterministic tests. */
  now?: Date
}

/**
 * Returns the headers to attach to the request, including `Authorization`.
 * The caller must send exactly the `body` that was passed in — the payload hash
 * is baked into the signature.
 */
export function signRequest(input: Sigv4Input): Record<string, string> {
  const {
    method,
    host,
    path,
    region,
    service,
    body,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  } = input

  const { amzDate, dateStamp } = sigv4Timestamps(input.now ?? new Date())
  const payloadHash = sha256Hex(body)

  // Signed headers must be lowercase and sorted; keep this list and the
  // canonical headers block in lockstep.
  const canonicalHeaderEntries: Array<[string, string]> = [
    ['content-type', 'application/json'],
    ['host', host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ]
  if (sessionToken) {
    canonicalHeaderEntries.push(['x-amz-security-token', sessionToken])
  }
  canonicalHeaderEntries.sort((a, b) => (a[0] < b[0] ? -1 : 1))

  const canonicalHeaders = canonicalHeaderEntries.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = canonicalHeaderEntries.map(([k]) => k).join(';')

  // No query string is used by the SESv2 calls we make, hence the empty line.
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kSigning = deriveSigningKey(secretAccessKey, dateStamp, region, service)
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
    Authorization:
      `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken

  return headers
}
