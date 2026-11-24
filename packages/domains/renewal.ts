import type { Placed } from './mod.ts'

export type Renewal = {
  expires: string
  cents: number
  checkout?: string
  credit?: number
}

export type Purchase = {
  eid: string
  at?: string | null
  order: Placed
  registered?: { at: string; expires?: string }
  courtesy?: { expires: string; space: string }
  renewal?: {
    expires: string
    cents: number
    checkout?: string
    credit?: number
  }
}

let transferred = ({ order }: Purchase) =>
  !!order.bought_by && order.bought_by != order.space

/** Use the owner's choice if still held. Otherwise use the earliest purchase
 * that registered, independent of its hostname or where it points. */
export let chosen = (
  orders: Purchase[],
  choice?: string | null,
): Purchase | undefined => {
  let held = orders.filter((r) => r.registered)
  return held.find((r) => r.eid == choice) ??
    held.sort((a, b) =>
      Number(transferred(a)) - Number(transferred(b)) ||
      (a.at ?? a.registered!.at).localeCompare(b.at ?? b.registered!.at) ||
      a.eid.localeCompare(b.eid)
    )[0]
}

let discount = (price: number, credit: number): number =>
  Math.min(price, credit)

export let covered = (purchase: Purchase, expires?: string | null): boolean =>
  !!expires && purchase.courtesy?.expires == expires &&
  purchase.courtesy.space == purchase.order.space

export let remaining = (
  purchase: Purchase,
  price: number,
  credit: number,
  expires?: string | null,
): number =>
  covered(purchase, expires) ||
    (purchase.renewal?.expires == expires &&
      purchase.renewal?.checkout)
    ? 0
    : price - discount(price, credit)

export let DAY = 86_400_000
export let RENEWAL_WINDOW = 60 * DAY

/** The allowance is spent for one domain's renewal year, dated by registry
 * expiration so the payment window can open before the old year ends. */
export type UsedCredit = { expires: string; order: string }

export let nextYear = (expires: string): number => {
  let date = new Date(expires)
  let month = date.getUTCMonth()
  date.setUTCFullYear(date.getUTCFullYear() + 1)
  if (date.getUTCMonth() != month) date.setUTCDate(0)
  return +date
}

export let creditFor = (
  purchase: Purchase,
  chosen: string | undefined,
  allowance: number,
  used: UsedCredit | null | undefined,
  expires?: string | null,
): number => {
  if (
    expires && purchase.renewal?.expires == expires && purchase.renewal.credit
  ) {
    return purchase.renewal.credit
  }
  if (purchase.eid != chosen || !expires) return 0
  return !used || Date.parse(expires) >= nextYear(used.expires) ? allowance : 0
}
