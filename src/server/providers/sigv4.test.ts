import { describe, expect, it } from 'vitest'
import { deriveSigningKey, signRequest, sigv4Timestamps } from './sigv4'

// AWS publishes the intermediate values for these example credentials, which is
// what makes the derivation assertion below a real check rather than a
// self-consistency test.
const EXAMPLE_SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'

describe('deriveSigningKey', () => {
  it('matches the AWS published derivation vector', () => {
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv4_signing.html
    // secret=wJalrX..., date=20120215, region=us-east-1, service=iam
    const key = deriveSigningKey(EXAMPLE_SECRET, '20120215', 'us-east-1', 'iam')
    expect(key.toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    )
  })

  it('produces a different key per region and per service', () => {
    const base = deriveSigningKey(EXAMPLE_SECRET, '20120215', 'us-east-1', 'ses')
    const otherRegion = deriveSigningKey(EXAMPLE_SECRET, '20120215', 'eu-west-1', 'ses')
    const otherService = deriveSigningKey(EXAMPLE_SECRET, '20120215', 'us-east-1', 'iam')

    expect(base.toString('hex')).not.toBe(otherRegion.toString('hex'))
    expect(base.toString('hex')).not.toBe(otherService.toString('hex'))
  })
})

describe('sigv4Timestamps', () => {
  it('formats both timestamps AWS expects', () => {
    const { amzDate, dateStamp } = sigv4Timestamps(new Date('2015-08-30T12:36:00.000Z'))
    expect(amzDate).toBe('20150830T123600Z')
    expect(dateStamp).toBe('20150830')
  })
})

describe('signRequest', () => {
  const input = {
    method: 'POST',
    host: 'email.us-east-1.amazonaws.com',
    path: '/v2/email/outbound-emails',
    region: 'us-east-1',
    service: 'ses',
    body: JSON.stringify({ FromEmailAddress: 'a@b.com' }),
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: EXAMPLE_SECRET,
    now: new Date('2015-08-30T12:36:00.000Z'),
  }

  it('builds an Authorization header with the right scope and signed headers', () => {
    const headers = signRequest(input)

    expect(headers.Authorization).toContain('AWS4-HMAC-SHA256')
    expect(headers.Authorization).toContain(
      'Credential=AKIDEXAMPLE/20150830/us-east-1/ses/aws4_request',
    )
    // Must be lowercase and sorted, and must match the canonical headers block.
    expect(headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    )
    expect(headers['X-Amz-Date']).toBe('20150830T123600Z')
  })

  it('is deterministic for a fixed instant', () => {
    expect(signRequest(input).Authorization).toBe(signRequest(input).Authorization)
  })

  it('changes the signature when the body changes', () => {
    const other = signRequest({ ...input, body: JSON.stringify({ FromEmailAddress: 'z@b.com' }) })
    expect(other.Authorization).not.toBe(signRequest(input).Authorization)
    // The payload hash is signed, so it must move with the body.
    expect(other['X-Amz-Content-Sha256']).not.toBe(signRequest(input)['X-Amz-Content-Sha256'])
  })

  it('includes the session token in the signature when present', () => {
    const withToken = signRequest({ ...input, sessionToken: 'FwoGZXIvYXdzEA==' })
    expect(withToken['X-Amz-Security-Token']).toBe('FwoGZXIvYXdzEA==')
    expect(withToken.Authorization).toContain('x-amz-security-token')
    expect(withToken.Authorization).not.toBe(signRequest(input).Authorization)
  })
})
