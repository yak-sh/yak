// A space's payments as its Selling and Billing pages draw them
// (@yaks/platform/payment-rows): its plan card, where it stands with selling
// and whom it is billed to, which no store holds, read of the space's row
// and its payment provider for the page graph's door (reach-door.ts) and the
// page's first paint (manage.ts). The door reads them again each time the
// directory says the space's row moved (side.ts `paymentRows`).
//
// And what those pages write there, done as the space's owner: the cap on
// its AI credit, an invoice asked for, its seller's account disconnected, and
// a button that leaves for the provider's page, answered with where to go.
import type { Bundle } from '@yaks/graph'
import {
  billedRows,
  type Part,
  type PaymentAct,
  planRow,
  sellingRow,
} from '@yaks/platform/payment-rows'
import { CallError } from '@yaks/tools/errors'
import {
  billedTo,
  buy,
  checkout,
  invoice,
  planCard,
  portal,
  setCap,
} from './billing.ts'
import { caught, defect } from './defects.ts'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { sentence } from './html.ts'
import { payments } from './payments.ts'
import {
  connect,
  disconnect,
  feeOf,
  linkable,
  linking,
  refusedSell,
  selling,
} from './sell.ts'

/** The space `eid` as `person`, its owner, holds it; none for anybody else,
 * or a space in the trash. */
export let ownedSpace = async (
  dir: Directory,
  person: string,
  eid: string,
): Promise<Space | undefined> =>
  (await dir.seated(person)).find((s) =>
    s.space.eid == eid && !s.space.trashed && s.role == 'owner'
  )?.space

/** The rows of `space` the page graph's `part` line holds. */
export let paymentRead = async (
  env: Env,
  dir: Directory,
  space: Space,
  part: Exclude<Part, 'allowances'>,
): Promise<Bundle[]> => {
  let pay = await payments(env)
  if (part == 'planCard') {
    return [planRow(space.eid, {
      ...planCard(pay.plans, space),
      provider: pay.name,
    })]
  }
  if (part == 'selling') {
    // Only where the provider can be asked at all, since a button that
    // cannot work is worse than no block.
    if (!pay.shops.on()) return []
    let [linked, fee] = await Promise.all([
      linkable(env, space),
      feeOf(dir),
    ])
    return [sellingRow(space.eid, {
      state: selling(space),
      house: !!space.seller?.house,
      linkable: linked,
      provider: pay.name,
      ...pay.shops.costs ? { costs: pay.shops.costs } : {},
      fee,
    })]
  }
  // A read that fails is reported, and the page says only that it bills.
  let payer = await billedTo(pay.plans, space).catch((e) => {
    caught(e, { request: 'read billing customer', space: space.slug })
    return null
  })
  return billedRows(space.eid, payer)
}

// What a refusal the billing doors answered says.
let refusing = (no: string | null) => {
  if (no) throw new CallError('arguments', sentence(no))
}

// Where a billing door's answer sends the person: its `url`, or its refusal.
let followed = async (answer: Response) => {
  let out = await answer.json() as {
    url?: string
    error?: { message: string }
  }
  if (!out.url) refusing(out.error?.message ?? 'That did not go through')
  return out.url!
}

/** Do `act` on `space` as `person`, its owner, signed in with `req`'s
 * session, and answer the rows it moved. */
export let paymentApply = async (
  act: PaymentAct,
  env: Env,
  req: Request,
  dir: Directory,
  space: Space,
  person: string,
): Promise<Bundle[]> => {
  if (act.creditCap) {
    let { cap } = act.creditCap
    refusing(await setCap(env, req, space, cap))
    return [
      act,
      ...await paymentRead(env, dir, {
        ...space,
        credit: { ...space.credit!, cap },
      }, 'planCard'),
    ]
  }
  if (act.invoiceAsk) {
    let { email, name } = act.invoiceAsk
    refusing(await invoice(env, req, space, { email, name }))
    return [act]
  }
  if (act.sellStop) {
    if (space.seller?.account) await disconnect(env, space)
    return [
      act,
      ...await paymentRead(env, dir, { ...space, seller: null }, 'selling'),
    ]
  }
  if (!act.leave) return []
  let { door, tier, per } = act.leave
  let url = door == 'checkout'
    ? await followed(
      await checkout(env, req, space, {
        tier: tier == 'pro' ? 'pro' : 'plus',
        per: per == 'year' ? 'year' : 'month',
      }),
    )
    : door == 'portal'
    ? await followed(await portal(env, req, space))
    : door == 'credit'
    ? await followed(await buy(env, req, space))
    : door == 'link'
    ? await linking(env, space, person)
    : await started(env, dir, space, person)
  return [{ ...act, leave: { ...act.leave, url } }]
}

// The provider's own hosted onboarding for a new account. A call to it that
// fails is filed, and the page says so.
let started = async (
  env: Env,
  dir: Directory,
  space: Space,
  person: string,
) => {
  let no = refusedSell(space, env)
  if (no) throw new CallError('conflict', no)
  try {
    return (await connect(env, space, await dir.emailAt(person) ?? '')).url
  } catch (e) {
    defect(e, { request: 'start selling' })
    let { name } = await payments(env)
    throw new CallError(
      'conflict',
      `We couldn't reach ${name} just now. Try again in a minute.`,
    )
  }
}
