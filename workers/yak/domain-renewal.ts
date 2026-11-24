// Directory and provider bindings for the annual renewal of a registered domain.
import {
  chosen,
  covered,
  creditFor,
  DAY,
  remaining,
  RENEWAL_WINDOW,
} from '@yaks/domains'
import { domainCredit } from '@yaks/platform/plans'
import { managePath } from '@yaks/platform/routes'
import { day } from '@yaks/ui/relative'
import type { Bundle } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { line } from '@yaks/query'
import { token } from '@yaks/graph/sha256'
import { derivedEid } from '@yaks/graph/identity'
import { type Directory, type Space } from './directory.ts'
import { registrationOf, renewalPrice } from './domains.ts'
import { plans } from './payments.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { deliverUpdate } from './support-reply.ts'

type Purchase = Awaited<ReturnType<Directory['domainOrders']>>[number]

export let creditOf = async (env: Env, { plan }: Space) => {
  let tier = plan?.tier ?? null
  let monthly = domainCredit(tier, 'month')
  let yearly = domainCredit(tier, 'year')
  if (monthly == yearly) return monthly
  if (plan?.per) return domainCredit(tier, plan.per)
  if (!plan?.subscription) return 0
  let provider = await plans(env)
  if (!provider.on()) return 0
  let subscription = await provider.subscription(plan.subscription)
  if (!subscription?.per) {
    throw new Error(`No billing interval for subscription ${plan.subscription}`)
  }
  return domainCredit(tier, subscription.per)
}

export let choiceOf = async (
  env: Env,
  space: Space,
  orders: Purchase[],
) => {
  let choice = chosen(orders, space.domainChoice)
  let credit = choice ? await creditOf(env, space) : 0
  return {
    choice,
    credit,
    for: (purchase: Purchase, expires: string | null | undefined) =>
      creditFor(purchase, choice?.eid, credit, space.domainCreditUsed, expires),
  }
}

export let chooseDomain = async (
  dir: Directory,
  space: Space,
  who: Who,
  name: string,
) => {
  if (who.role != 'owner') {
    throw new CallError(
      'access',
      'Only a space owner can choose its included domain.',
    )
  }
  let order = (await dir.domainOrders(space)).find((r) =>
    r.registered && r.order.name == name
  )
  if (!order) {
    throw new CallError('missing', 'This space does not hold that domain.')
  }
  await dir.stamp({
    entities: [{
      entity: { eid: order.eid },
      $was: { domain_order: { space: token(space.eid) } },
    }, {
      entity: { eid: space.eid },
      domain_choice: { order: order.eid },
    }],
  }, vouched(who))
}

let tell = async (
  env: Env,
  dir: Directory,
  space: Space,
  purchase: Purchase,
  key: string,
  words: string,
) => {
  let owners = await dir.owners(space)
  let path = managePath('domains', space.slug) + '#' + purchase.order.name
  await Promise.all(owners.map((person) => {
    let eid = derivedEid(`domain-renewal|${key}|${purchase.eid}|${person}`)
    return deliverUpdate(env, space.eid, {
      person,
      session: null,
      note: { eid, body: words, by: null, via: null },
      update: {
        id: eid,
        to: person,
        words: `${words} [Manage domain](${path})`,
      },
    })
  }))
}

let mark = async (
  dir: Directory,
  purchase: Purchase,
  part: string,
  value: Record<string, unknown>,
) =>
  await dir.stamp({
    entities: [{
      entity: { eid: purchase.eid },
      [part]: value,
      $was: { domain_order: { space: token(purchase.order.space) } },
    }],
  })

/** Give an existing monthly subscriber one last covered renewal. The receipt
 * stays with the original owner even if the domain moves. */
let grandfather = async (
  env: Env,
  dir: Directory,
  space: Space,
  purchase: Purchase,
  expires: string,
  on: boolean,
) => {
  if (
    purchase.order.renewalTerms || purchase.courtesy || !on ||
    !space.plan || !domainCredit(space.plan.tier, 'year') ||
    domainCredit(space.plan.tier, 'month') || await creditOf(env, space)
  ) return purchase
  let courtesy = { expires, space: space.eid }
  await mark(dir, purchase, 'domain_courtesy', courtesy)
  return { ...purchase, courtesy }
}

let courtesyNotice = (
  env: Env,
  dir: Directory,
  space: Space,
  purchase: Purchase,
  expires: string,
) =>
  tell(
    env,
    dir,
    space,
    purchase,
    'terms',
    `Your next renewal for ${purchase.order.name}, due by ${
      day(expires, 'UTC')
    }, is still covered. ` +
      'After that, it renews at the registrar’s price with no markup. ' +
      'The Plus plan covers up to $12 a year toward one domain renewal when you pay yearly.',
  )

export let prepareRenewal = async (
  env: Env,
  dir: Directory,
  space: Space,
  purchase: Purchase,
  now: number,
) => {
  let current = await registrationOf(env, purchase.order.name)
  let expires = current?.expires_at ?? purchase.registered?.expires
  if (!expires || Date.parse(expires) <= now) return
  purchase = await grandfather(
    env,
    dir,
    space,
    purchase,
    expires,
    !!current?.auto_renew,
  )
  if (covered(purchase, expires)) {
    await courtesyNotice(env, dir, space, purchase, expires)
  }
  if (Date.parse(expires) - now > RENEWAL_WINDOW) return
  if (purchase.renewal?.expires != expires) {
    let cents = await renewalPrice(env, purchase.order.name)
    await dir.stamp({
      entities: [{
        entity: { eid: purchase.eid },
        domain_renewal: {
          expires,
          cents,
          checkout: null,
          credit: null,
        },
        $was: {
          domain_order: { space: token(purchase.order.space) },
          domain_renewal: { expires: token(purchase.renewal?.expires) },
        },
      }],
    })
    purchase = { ...purchase, renewal: { expires, cents } }
  }
  let terms = await choiceOf(env, space, await dir.domainOrders(space))
  let price = purchase.renewal!.cents
  let credit = terms.for(purchase, expires)
  let due = remaining(purchase, price, credit, expires)
  if (
    credit > 0 && due == 0 && !covered(purchase, expires) &&
    !purchase.renewal?.checkout && !purchase.renewal?.credit &&
    Date.parse(expires) - now <= 32 * DAY
  ) {
    await funded(dir, space, purchase, expires, price)
  }
  if (due > 0) {
    await tell(
      env,
      dir,
      space,
      purchase,
      expires,
      `Renewal for ${purchase.order.name} is due by ${
        day(expires, 'UTC')
      }. Open Domains to review and pay.`,
    )
  }
}

export let optedIn = (
  purchase: Purchase,
  credit: number,
  expires: string | null | undefined,
  now: number,
) => {
  let price = purchase.renewal?.expires == expires
    ? purchase.renewal?.cents
    : purchase.order.renews
  if (covered(purchase, expires)) return true
  let prepared = purchase.renewal?.expires == expires
    ? purchase.renewal
    : undefined
  if (
    prepared?.checkout ||
    prepared?.credit && prepared.credit >= prepared.cents
  ) return true
  return !!expires && Date.parse(expires) - now > 32 * DAY &&
    price != null && remaining(purchase, price, credit, expires) == 0
}

let allocation = (
  space: Space,
  purchase: Purchase,
  expires: string,
): Bundle => ({
  entity: { eid: space.eid },
  domain_credit_used: { order: purchase.eid, expires },
  $was: {
    domain_credit_used: { expires: token(space.domainCreditUsed?.expires) },
    domain_choice: { order: token(space.domainChoice) },
    plan: { tier: token(space.plan?.tier), per: token(space.plan?.per) },
  },
})

let funded = (
  dir: Directory,
  space: Space,
  purchase: Purchase,
  expires: string,
  credit: number,
  checkout?: string,
) =>
  dir.stamp({
    entities: [
      ...credit > 0 ? [allocation(space, purchase, expires)] : [],
      {
        entity: { eid: purchase.eid },
        domain_renewal: {
          ...credit > 0 ? { credit } : {},
          ...checkout ? { checkout } : {},
        },
        $was: {
          domain_order: { space: token(space.eid) },
          domain_renewal: {
            expires: token(expires),
            credit: null,
            checkout: null,
          },
        },
      },
      ...checkout
        ? [{
          entity: { eid: paidReceipt(checkout) },
          domain_renewal_paid: { order: purchase.eid, expires },
          $was: { domain_renewal_paid: { order: null } },
        }]
        : [],
    ],
  })

export let paidReceipt = (checkout: string) =>
  derivedEid(`domain-renewal-paid|${checkout}`)

export let boughtRenewal = funded

export let nextRenewal = line`.domain_registered&.domain_order`
