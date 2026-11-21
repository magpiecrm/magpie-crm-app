import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validInput } from './validInput'

describe('validInput', () => {
  const schema = z.object({ email: z.string().trim().email("That isn't an email address."), name: z.string().max(3, 'Too long.') })

  it('gives back the parsed input', () => {
    expect(validInput(schema, { email: ' a@b.co ', name: 'Jo' })).toEqual({ email: 'a@b.co', name: 'Jo' })
  })

  it('refuses with the first problem in words, not the JSON of every issue', () => {
    expect(() => validInput(schema, { email: 'not one', name: 'Jonathan' })).toThrow(new Error("That isn't an email address."))
  })
})
