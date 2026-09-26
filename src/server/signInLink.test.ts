import { beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { createSignInToken, redeemSignInToken, resetSignInLinks } from './signInLink'

const secret = 'a'.repeat(64)
const isUser = (email: string) => email === 'owner@acme.test'
const now = 1_790_000_000_000

beforeEach(() => resetSignInLinks())

describe('sign-in links', () => {
  it('signs in a known user once', () => {
    const token = createSignInToken('owner@acme.test', secret, now)
    expect(redeemSignInToken(token, secret, isUser, now)).toEqual({ ok: true, email: 'owner@acme.test' })
    expect(redeemSignInToken(token, secret, isUser, now + 1000)).toEqual({ ok: false, reason: 'used' })
  })

  it('refuses an expired link', () => {
    const token = createSignInToken('owner@acme.test', secret, now, 60)
    expect(redeemSignInToken(token, secret, isUser, now + 61_000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a link valid for longer than two minutes', () => {
    const token = createSignInToken('owner@acme.test', secret, now, 3600)
    expect(redeemSignInToken(token, secret, isUser, now)).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a link signed with another secret', () => {
    const token = createSignInToken('owner@acme.test', 'b'.repeat(64), now)
    expect(redeemSignInToken(token, secret, isUser, now)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses a link whose email was changed', () => {
    const token = createSignInToken('owner@acme.test', secret, now)
    const [payload, signature] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const forged = Buffer.from(JSON.stringify({ ...claims, email: 'other@acme.test' })).toString('base64url')
    expect(redeemSignInToken(`${forged}.${signature}`, secret, () => true, now)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses an email that is not a user here', () => {
    const token = createSignInToken('stranger@acme.test', secret, now)
    expect(redeemSignInToken(token, secret, isUser, now)).toEqual({ ok: false, reason: 'unknown-user' })
  })

  it('refuses everything when the secret is too short', () => {
    const short = 'short-secret'
    const token = createSignInToken('owner@acme.test', short, now)
    expect(redeemSignInToken(token, short, isUser, now)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses malformed tokens', () => {
    for (const token of ['', 'abc', 'a.b.c', '.sig', `${Buffer.from('not json').toString('base64url')}.x`]) {
      expect(redeemSignInToken(token, secret, isUser, now)).toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('matches the documented format, so the portal can make links without this code', () => {
    const payload = Buffer.from(
      JSON.stringify({ email: 'owner@acme.test', exp: Math.floor(now / 1000) + 60, nonce: 'n'.repeat(22) }),
    ).toString('base64url')
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
    expect(redeemSignInToken(`${payload}.${signature}`, secret, isUser, now).ok).toBe(true)
  })
})
