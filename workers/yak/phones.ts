// The phones the platform texts and calls through: each provider plugin
// config.ts `phoneConfig` names, lent under its name (lent.ts) with
// the options its entry gives it, every secret among them read from the
// Worker's environment at its use. Nothing here names a provider: the
// Operator's texts and calls, an app's texts and the sign-up texts all go
// through the phone a name selects.
import { Blocked, type Transport } from '@yaks/phone'
import { directoryOf } from './directory.ts'
import type { Phone } from '@yaks/phone/plugin'
import { phoneConfig } from './config.ts'
import type { Env } from './env.ts'
import { sharing } from './lib/shared.ts'

// One lending per environment. Its options read the environment as they are
// used, so a secret put after the first text is used by the next.
let held = new WeakMap<object, Promise<Record<string, Phone>>>()

// A phone plugin's texter is its phone (@yaks/phone/plugin `texters`).
let lend = async (env: Env) =>
  await (await import('./lent.ts')).lent(env, 'texters', phoneConfig) as Record<
    string,
    Phone
  >

/** Every phone config.ts `phoneConfig` lends, by name. Two plugins lending
 * one name are refused: which answers would be an accident of order. */
export let phones = (env: Env): Promise<Record<string, Phone>> =>
  sharing(held, env, () => lend(env))

/** The phone config.ts `phoneConfig` lends as `via`, where one does. */
export let phoneNamed = async (
  env: Env,
  via: string,
): Promise<Phone | undefined> => {
  let all = await phones(env)
  return Object.hasOwn(all, via) ? all[via] : undefined
}

/**
 * The phone a text goes through: the one `chosen` names, a space's own
 * (`sender{via}` beside its `phone{number}`), else the platform's
 * (`PHONE_SENDER`), whose settings lie under any choice of the same
 * provider. Undefined where none is chosen or no plugin lends it.
 */
export let phoneAt = async (
  env: Env,
  chosen?: Transport,
): Promise<Phone | undefined> => {
  let base = env.PHONE_SENDER
  let via = chosen?.via ?? base?.via
  let phone = via ? await phoneNamed(env, via) : undefined
  if (!phone) return undefined
  let { via: _, ...more } = { ...base?.via == via ? base : {}, ...chosen }
  return guarded(
    env,
    phone.over(more),
    phone.over(base && base.via == via ? base : {}),
  )
}

// Every outgoing text, including queued work with an old assignment, asks
// the present trash state at the generic phone boundary.
let guarded = (env: Env, phone: Phone, platform: Phone): Phone => ({
  ...phone,
  over: (more) => guarded(env, phone.over(more), platform),
  send: async (text) => {
    let number = text.from ?? await phone.from()
    let dir = directoryOf(env.STORE)
    let held = number ? await dir.heldLine(number) : null
    if (held?.line.trashed || held?.space.trashed) {
      throw new Blocked('This phone number is in the trash.')
    }
    if (
      number && !held && number != await platform.from() &&
      !await dir.textSpace(number) && !await dir.lined(number)
    ) {
      throw new Blocked('This phone number is no longer assigned.')
    }
    return await phone.send(text)
  },
})

/** {@link phoneAt}, which a text cannot go without. */
export let phoneOf = async (env: Env, chosen?: Transport): Promise<Phone> => {
  let phone = await phoneAt(env, chosen)
  if (phone) return phone
  let via = chosen?.via ?? env.PHONE_SENDER?.via
  throw new Error(via ? `No phone provider ${via}` : 'No phone is chosen here')
}

/**
 * Whether the platform texts people who are not signed in: signing up by text
 * (`TEXT_SIGNUP`) is switched on, off until the toll-free verification covers
 * it (T-138775), and the platform's phone holds what it needs to send. The
 * invite's QR code (referral.ts `numberOf`) and a code by text on the sign-in
 * card (identity.ts) wait on it alike.
 */
export let textable = async (env: Env): Promise<boolean> => {
  if (env.TEXT_SIGNUP != 'on') return false
  let phone = await phoneAt(env)
  return !!phone && !phone.waiting?.()
}
