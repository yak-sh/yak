// Proving a new number is shared by settings and conversation contacts.
// Existing holders keep their number; only a texted code can replace it.
import type { Env } from './env.ts'
import { directoryOf, type Space } from './directory.ts'
import { meta } from './meta.ts'
import { codeText, mayText, mint, spend, visitor } from './signin.ts'
import { REPLIES, texts } from './operator-texts.ts'
import { phoneOf } from './phones.ts'
import { charged } from './text-spend.ts'
import { refuse, rejected } from './tool.ts'
import { status } from '@yaks/graph/errors'
import type { Arrival } from './signin.ts'
import type { Meta } from './meta.ts'

let claim = async (
  store: Meta,
  secret: string,
  number: string,
  code: string,
  contact: Arrival,
) => {
  try {
    return await spend(store, secret, number, code, contact)
  } catch (error) {
    let http = status(error)
    if (http < 500) throw rejected(http, (error as Error).message)
    throw error
  }
}

export type PhoneProof = { pending: true; number: string; message: string }

export let provePhone = async (
  env: Env,
  person: string,
  space: Space,
  number: string,
  agreed: boolean,
  code = '',
  source?: string,
): Promise<PhoneProof | null> => {
  let [phone] = texts(person, number, agreed)
  let address = (phone.phone as { number: string }).number
  let dir = directoryOf(env.STORE)
  let owner = await dir.phoned(address)
  if (owner && owner != person) {
    throw refuse(
      'conflict',
      'That contact belongs to another account. Sign in with it to use that account.',
    )
  }
  if (await dir.phoneAt(person) == address) {
    await consentPhone(env, person, space, address, source)
    return null
  }
  let secret = env.SESSION_SECRET
  if (!secret) throw new Error('Phone verification has no session secret')
  let store = meta(env)
  let contact = { person, space: space.eid, source }
  if (code) {
    let arrived = /^\d{6}$/.test(code)
      ? await claim(store, secret, address, code, contact)
      : null
    if (!arrived) {
      throw refuse(
        'arguments',
        'That code does not match, expired, or has no guesses left. Check it or request a new code.',
      )
    }
    if (arrived.contact) await welcome(env, space, address)
    return null
  }
  let from = await visitor(secret, person)
  if (!await mayText(store, from)) {
    throw refuse(
      'limit',
      'You have requested five text codes this hour. Use one already sent or try later.',
    )
  }
  let digits = await mint(store, secret, address, from, {
    person,
    space: space.eid,
  })
  if (!digits) {
    throw refuse(
      'limit',
      'That number has had three codes this hour. Use one already sent or try later.',
    )
  }
  await charged(env, space, await phoneOf(env)).send({
    to: address,
    text: codeText(digits),
  })
  return {
    pending: true,
    number: address,
    message:
      'We texted a six-digit code. Enter it below and save again to confirm your mobile number.',
  }
}

let welcome = async (env: Env, space: Space, number: string) =>
  await charged(env, space, await phoneOf(env)).send({
    to: number,
    text: REPLIES.welcome,
  })

/** An existing holder can agree again without proving the number anew. */
export let consentPhone = async (
  env: Env,
  person: string,
  space: Space,
  number: string,
  source?: string,
) => {
  let dir = directoryOf(env.STORE)
  let arrived = await claim(meta(env), env.SESSION_SECRET!, number, '', {
    person,
    space: space.eid,
    source,
  })
  if (!arrived) {
    throw refuse('conflict', 'Your mobile number changed. Try again.')
  }
  if (arrived.contact) await welcome(env, space, number)
  return dir.texting(person)
}
