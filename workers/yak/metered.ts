// The doors a space's letters and an app's own model API go through, counted
// against its allowances (@yaks/platform/meter) where they happen.
import type { Host } from '@yaks/platform/host'
import { type Sender, Undeliverable } from '@yaks/mail'
import { type Listed, ModelError, type Native, type Price } from '@yaks/model'
import type { Namespace } from '@yaks/durable-object/door'
import { type Directory, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { mailedTo, outgoing } from './post.ts'
import { usedMail } from './space-mail.ts'
import { defect } from './defects.ts'
import { reserved } from './model-spend.ts'
import { counted } from './meter.ts'
import { refusedSpend } from '@yaks/platform/standing'

/**
 * A letter counted against `space`: the month's allowance read before it
 * goes, the count written after it went.
 *
 * It wraps the transport rather than sitting in the effect, so the two rules
 * ride the one seam @yaks/mail already has: over the allowance the letter is
 * `Undeliverable`, which the sending effect comes to rest on as
 * `bounced{reason}` naming the ceiling, with nothing failed; and a transport
 * that refused for its own reasons never reaches the count.
 */
export let charging = (
  bind: Partial<Env> & { STORE: Namespace },
  space: Space,
  sender: Sender,
): Sender => ({
  send: async (m) => {
    let no = refusedSpend(space, 'emails', bind)
    if (no) throw new Undeliverable(no)
    let receipt = await sender.send(m)
    await counted({ STORE: bind.STORE }, space)
    // A Plus plan space's first letter sets its subdomain up for mail.
    await usedMail(bind, space)
    return receipt
  },
})

/**
 * A letter counted against the space whose mailbox an app store sends from
 * ({@link charging}).
 *
 * A store with no namespace bound and one that cannot name its own mailbox
 * both send uncounted — the stand-in in a test, an object that has not learned
 * its address yet — the way an unset analytics token meters nothing.
 */
export let metering = (
  bind: Partial<Env> & { STORE?: Namespace },
  from: () => string | null,
  sender: Sender,
): Sender => ({
  send: async (m) => {
    let ns = bind.STORE
    let box = ns ? await mailedTo(from() ?? '', directoryOf(ns), bind) : null
    if (!ns || !box) return await sender.send(m)
    return await charging({ ...bind, STORE: ns }, box.space, sender).send(m)
  },
})

/**
 * The sender a space's Operator store lends @yaks/mail as `operator`
 * (operator-store.ts): a letter leaves from its space's own address, counted
 * against that space ({@link charging}), and its provider's notices about it
 * come back to that space's Operator (mail-receipts.ts). A letter from any
 * other address is not the Operator's to send, and bounces. A letter
 * yaks.app owes the person (`owed`, the letter's `operator_letter.platform`:
 * an invitation, a contact code) is sent in the Operator's name and never
 * counted, as the platform's own letters never are.
 */
export let operatorPost = (
  env: Partial<Env> & { STORE: Namespace },
  owed: (letter: string) => Promise<boolean> = () => Promise.resolve(false),
): Sender => ({
  send: async (m) => {
    let box = await mailedTo(m.from, directoryOf(env.STORE), env)
    if (!box || box.app) {
      throw new Undeliverable(`${m.from} is not a space’s own address`)
    }
    let { space } = box
    let sender = outgoing(env, { yak_operator: space.eid })
    if (m.id && await owed(m.id)) return await sender.send(m)
    return await charging(env, space, sender).send(m)
  },
})

// ---- the models (D-40545) ---------------------------------------------------
//
// A model call is counted where it happens, like a letter and for the same
// reason: nothing in the analytics knows which space asked. The budget is
// read before the call and the call weighed after it, by its model's price in
// the catalogue (models.ts). Each call reserves its bounded maximum first.

/**
 * The door an app reaches its models' own API through: the own door of the
 * first provider config.ts `answering` names whose door answers the model
 * asked for (providers.ts `native`), OpenAI's for the chat models apps
 * already name and Workers AI's binding for the rest: `./api/ai/run`,
 * documents and embeddings are lent it. A call that could not be counted, with
 * no namespace to count it in or no space to count it against, is refused
 * before anything is spent, since nothing reaches a provider unmetered.
 *
 * Each call holds what its provider quotes against the space's budget
 * (model-spend.ts) and settles at its cost. Over the budget it throws a
 * `ModelError` coded `limit` carrying the ceiling's sentence, which a
 * transcript comes to rest on (@yaks/session `LIMIT`) and the direct door
 * answers 429 with. What the provider says is the platform's to hear (the
 * account's own credit spent, a model it prices nothing for) is reported.
 * A `visitor`'s calls, named by who they are, are held to their share of
 * the budget and to the calls one visitor may ask for in a day as well.
 */
export let metered = (
  bind: Partial<Env> & { STORE?: Namespace } & Host,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  rows?: {
    price(name: string): Promise<Price | undefined>
    answered(provider: string, name: string, info: Listed): Promise<void>
  },
  visitor?: string,
): Native => ({
  run: async (model, input, options) => {
    let ns = bind.STORE
    let dir = ns ? directoryOf(ns) : null
    let space = dir ? await spaceOf(dir) : null
    let provider = ''
    let { native, platform } = await import('./providers.ts')
    let door = ns && space
      ? native(bind, platform(bind as Env), {
        hold: (quote) =>
          reserved({ STORE: ns }, space, quote, undefined, {
            visitor,
            source: provider,
          }),
        answered: (name, info) =>
          rows?.answered(provider, name, info) ?? Promise.resolve(),
        report: (e, model) =>
          e instanceof ModelError && e.code == 'model'
            ? defect(e, { request: 'model price', model }, {
              fault: `model-price:${model}`,
            })
            : defect(e, { request: `model ${model}`, space: space.slug }),
      }, model)
      : undefined
    if (!door) {
      throw new ModelError(
        'unbound',
        'No model can be asked here: nothing binds this store to a provider ' +
          'and to the space that pays for it',
      )
    }
    provider = door.provider
    return await door.run(model, input, options)
  },
})
