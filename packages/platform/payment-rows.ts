/**
 * What a space's Selling and Billing pages (./payment-view.ts) are drawn
 * from, as the tab's page graph holds it (D-475 step 5), and what they write
 * there:
 *
 * - `planCard{space, tier, …}`, `selling{space, state, …}` and
 *   `billedTo{space, email, name}`: the space's plan, where it stands with
 *   selling, and whom the payment provider bills. No store holds them: the
 *   page graph's door answers each line as a server read of the space and
 *   its provider, and reads it again as the space's directory row moves
 *   (yaks.app's payment-reads.ts).
 * - `allowances{space, limits, budget, read}`: the space's month against its
 *   allowances, which the directory answers from the space's row as a read of
 *   the person, live (./person-lines.ts).
 * - `creditCap{space, cap}`, `invoiceAsk{space, email, name}`,
 *   `sellStop{space}` and `leave{space, door, tier, per}`: acts the door
 *   does as the space's owner. `leave` is answered with the provider's page
 *   to go to, as `leave{url}`.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { derivedEid } from '@yaks/graph/identity'
import { mint } from '@yaks/graph'
import type { Costs, Per } from '@yaks/host/payments'
import type { VocabDoc } from '@yaks/vocab'
import type { Budget } from './meter.ts'
import type { Tier } from './plans.ts'
import type { Ceiling, Gauge } from './standing.ts'
import paymentJson from './vocab/payment.vocab.json' with { type: 'json' }

/** A plan a person can buy, and how often it is paid for. */
export type Want = { tier: 'plus' | 'pro'; per: Per }

/** What the plan card shows: the space's tier, the day it lapses if it is
 * leaving, whether the provider has ever known it (which is what makes
 * Manage billing worth offering), how each paid plan is sold here, and the
 * provider's name. */
export type PlanCard = {
  tier: Tier
  ends: string
  known: boolean
  /** the day the Plus plan given free runs through, while it does */
  free?: string
  sold: Record<Want['tier'], Per[]>
  /** the days an invoice gives to pay, where the yearly plan may be paid by
   * invoice */
  invoice?: number
  /** whether its subscription is made and waits on its first payment */
  awaiting?: boolean
  /** its AI credit, where its plan buys credit or it holds some: the cap,
   * what is left to spend this month, what this month drew, and whether a
   * block may be bought now */
  credit?: { cap: number; left: number; drawn: number; buy: boolean }
  /** the payment provider that bills it, as the card names it */
  provider?: string
}

/** Where a space stands with selling, where the provider takes sellers: its
 * account's state, whether it sells as the house, whether its owner may
 * connect an account they already have, and what selling costs. */
export type Selling = {
  state: 'none' | 'setup' | 'ready'
  house: boolean
  linkable: boolean
  provider: string
  costs?: Costs
  /** what the platform takes from each sale, in basis points */
  fee: number
}

/** Whom a space is billed to, as the provider holds its payer. */
export type Payer = { email: string; name: string }

/** The space's month: each allowance it answers to and how much of it is
 * used, its model budget, and when the hourly sweep last read them. */
export type Allowances = {
  limits: Partial<Record<Ceiling, Gauge>>
  budget: Budget
  read: string | null
}

/** A button that leaves for the provider's page: a plan bought, its billing
 * managed, credit bought, or a seller's account opened or connected. */
export type Door = 'checkout' | 'portal' | 'credit' | 'start' | 'link'

/** What a page of a space's payments draws from each line. */
export type Part = 'planCard' | 'selling' | 'billedTo' | 'allowances'

let PARTS: Part[] = ['planCard', 'selling', 'billedTo', 'allowances']

let lineOf = (part: Part, space: string) => `.${part}.space=${space}`

/** The space's plan card. */
export let planLine = (space: string): string => lineOf('planCard', space)

/** Where the space stands with selling; none where the provider takes no
 * sellers. */
export let sellingLine = (space: string): string => lineOf('selling', space)

/** Whom the space is billed to; none where nobody is, or the provider could
 * not be asked. */
export let billedLine = (space: string): string => lineOf('billedTo', space)

/** The space's month against its allowances. */
export let allowancesLine = (space: string): string =>
  lineOf('allowances', space)

/** The part and the space a payment line asks about, or undefined for
 * another line. */
export let paymentPart = (
  line: string,
): { part: Part; space: string } | undefined => {
  let m = /^\.(\w+)\.space=(.+)$/.exec(line)
  let part = m?.[1] as Part | undefined
  return part && PARTS.includes(part) ? { part, space: m![2] } : undefined
}

/** Whether the directory answers `line` as a read of the person: every
 * payment line, the allowances as the page's rows and the rest as what the
 * door reads them again on. */
export let paymentLine = (line: string): boolean => !!paymentPart(line)

export let paymentWords: VocabDoc = paymentJson as VocabDoc

let row = (part: Part, space: string, value: object): Bundle => ({
  entity: { eid: derivedEid(`${part}|${space}`) },
  [part]: { ...value, space },
})

/** The space's plan card, as a row. */
export let planRow = (space: string, plan: PlanCard): Bundle =>
  row('planCard', space, plan)

/** Where the space stands with selling, as a row. */
export let sellingRow = (space: string, selling: Selling): Bundle =>
  row('selling', space, selling)

/** Whom the space is billed to, as rows: none for nobody. */
export let billedRows = (space: string, payer: Payer | null): Bundle[] =>
  payer ? [row('billedTo', space, payer)] : []

/** The space's month, as a row. */
export let allowancesRow = (space: string, month: Allowances): Bundle =>
  row('allowances', space, month)

let of = <T>(rows: Bundle[], part: Part): T | undefined => {
  let found = rows.find((r) => r[part])?.[part] as
    | (T & { space: string })
    | undefined
  if (!found) return undefined
  let { space: _, ...rest } = found
  return rest as T
}

/** The plan card `rows` hold, if any. */
export let planOf = (rows: Bundle[]): PlanCard | undefined =>
  of<PlanCard>(rows, 'planCard')

/** Where selling stands in `rows`, if they say. */
export let sellingOf = (rows: Bundle[]): Selling | undefined =>
  of<Selling>(rows, 'selling')

/** Whom `rows` say the space is billed to, if anybody. */
export let payerOf = (rows: Bundle[]): Payer | undefined =>
  of<Payer>(rows, 'billedTo')

/** The month `rows` hold, if any. */
export let allowancesOf = (rows: Bundle[]): Allowances | undefined =>
  of<Allowances>(rows, 'allowances')

/** One act on a space's payments, as a write of it is. */
export type PaymentAct = Bundle & {
  creditCap?: { space: string; cap: number }
  invoiceAsk?: { space: string; email: string; name: string }
  sellStop?: { space: string }
  leave?: { space: string; door: Door; tier?: string; per?: string }
}

let ACTS = ['creditCap', 'invoiceAsk', 'sellStop', 'leave']

/** Where the provider's page a button leaves for is, as `space`'s owner
 * writes its `leave` through `graph`: the button says its `door`, and the
 * plan it buys in `plan` and `per`. Undefined where nothing said. */
export let leaveTo = async (
  graph: Pick<Client, 'mutate'>,
  space: string,
  button: HTMLElement,
): Promise<string | undefined> => {
  let { door, plan, per } = button.dataset
  let [answer] = await graph.mutate([{
    entity: { eid: mint() },
    leave: { space, door: door as Door, ...plan ? { tier: plan, per } : {} },
  }], { optimistic: false })
  return (answer?.leave as { url?: string } | undefined)?.url
}

/** The space a write of `bundles` acts on and the act, when it is one act on
 * a space's payments, else undefined. */
export let paymentWrite = (
  bundles: Bundle[],
): { space: string; act: PaymentAct } | undefined => {
  let [b, ...rest] = bundles
  let name = b && ACTS.find((a) => a in b)
  let space = name && (b[name] as { space?: string }).space
  return !rest.length && space ? { space, act: b as PaymentAct } : undefined
}
