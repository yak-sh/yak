// Gifts to a space's fund (workers/yak/sell.ts `giving`): what a donor may
// ask to give, what covering the provider's fee adds, and what a receipt and a
// year-end statement say. Pure: the door reads the fund row and the provider's
// costs and hands them here, and writes what comes back.
import { type Costs, covering } from '@yaks/host/payments'

/** A fund as its row carries it (`fund{holder, amounts_cents, statement}`
 * and `doc.title`). */
export type Fund = {
  title: string
  holder: string
  amounts: number[]
  statement: string
  test?: boolean
}

/** What a receipt says was given in return, unless the fund says otherwise. */
export let NOTHING_GIVEN =
  'No goods or services were provided in exchange for this gift.'

/** The fund off its row: suggested amounts read from the comma-separated
 * cents, dropping what is not a whole positive number, the holder falling back
 * to the fund's title.
 *
 * ```ts
 * import { fundOf } from '@yaks/platform/giving'
 * import { equal } from '@yaks/testing'
 * equal(fundOf({ doc: { title: 'Roof' }, fund: { amounts_cents: '2500, 5000, x' } }), {
 *   title: 'Roof', holder: 'Roof', amounts: [2500, 5000],
 *   statement: 'No goods or services were provided in exchange for this gift.',
 * })
 * ```
 */
export let fundOf = (row: {
  doc?: { title?: string | null } | null
  fund_receipt?: { holder?: string | null; statement?: string | null } | null
  fund?: {
    holder?: string | null
    amounts_cents?: string | null
    statement?: string | null
    test?: boolean | null
  } | null
}): Fund => {
  let title = row.doc?.title?.trim() || 'Gift'
  return {
    title,
    holder: row.fund_receipt?.holder?.trim() || row.fund?.holder?.trim() ||
      title,
    amounts: String(row.fund?.amounts_cents ?? '').split(',')
      .map((a) => Number(a.trim()))
      .filter((a) => Number.isInteger(a) && a > 0),
    statement: row.fund_receipt?.statement?.trim() ||
      row.fund?.statement?.trim() || NOTHING_GIVEN,
    ...(row.fund?.test != null ? { test: row.fund.test } : {}),
  }
}

/** One gift as a donor asks for it: the amount, whether it repeats monthly,
 * and whether they cover the fee. */
export type Asked = { cents: number; monthly: boolean; cover: boolean }

/** The gift as charged: the donor's amount, what covering the fee adds, and
 * the whole. */
export type Charge = { cents: number; covered: number; total: number }

/** The most one gift may be, in cents: a typo past it is refused, not
 * charged. */
export let MOST = 10_000_00

/** What the donor asked, read off a request body and priced, or the sentence
 * that says what to fix. `minimum` is the provider's least charge.
 *
 * ```ts
 * import { charge } from '@yaks/platform/giving'
 * import { equal } from '@yaks/testing'
 * let card = { bps: 290, cents: 30 }
 * equal(charge({ cents: 10000, cover: true }, card, 50), {
 *   asked: { cents: 10000, monthly: false, cover: true },
 *   charge: { cents: 10000, covered: 330, total: 10330 },
 * })
 * equal(charge({ cents: 10 }, card, 50), { refused: 'a gift is at least $0.50' })
 * ```
 */
export let charge = (
  body: unknown,
  card: Costs['card'],
  minimum: number,
  recurring = 0,
): { asked: Asked; charge: Charge } | { refused: string } => {
  let b = (body ?? {}) as Record<string, unknown>
  let cents = Number(b.cents)
  if (!Number.isInteger(cents) || cents <= 0) {
    return { refused: 'cents: the gift in whole cents, such as 2500 for $25' }
  }
  if (cents < minimum) {
    return { refused: `a gift is at least ${money(minimum)}` }
  }
  if (cents > MOST) return { refused: `a gift is at most ${money(MOST)}` }
  let asked = { cents, monthly: b.monthly === true, cover: b.cover === true }
  let rate = asked.monthly ? { ...card, bps: card.bps + recurring } : card
  let covered = asked.cover ? covering(rate, cents) : 0
  return { asked, charge: { cents, covered, total: cents + covered } }
}

/** Cents as dollars: `$25.00`. */
export let money = (cents: number) =>
  `$${
    (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`

/** A day as a receipt writes it: `November 25, 2026`. */
export let day = (at: string) =>
  new Date(at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

/** One gift received, as a receipt or a statement reads it. */
export type Received = {
  total: number
  covered: number
  at: string
  monthly: boolean
}

/** The donor's receipt, Markdown, as an app's letters are: who received it,
 * how much and when, what was given in return, and for a monthly gift where
 * to change or cancel it.
 *
 * ```ts
 * import { receipt } from '@yaks/platform/giving'
 * import { equal } from '@yaks/testing'
 * let fund = { title: 'Roof', holder: 'Grace Hall Inc.', amounts: [], statement: 'Nothing given.' }
 * let got = receipt(fund, { total: 2606, covered: 106, at: '2026-11-25T12:00:00Z', monthly: true }, 'https://x/cancel')
 * equal(got.title, 'Your gift to Roof')
 * equal(got.body.includes('Grace Hall Inc. received your monthly gift of **$26.06** on November 25, 2026'), true)
 * equal(got.body.includes('[change or cancel your monthly gift](https://x/cancel)'), true)
 * ```
 */
export let receipt = (
  fund: Fund,
  gift: Received & { test?: boolean },
  cancel?: string,
) => ({
  title: `${gift.test ? 'Test receipt: ' : ''}Your gift to ${fund.title}`,
  body: [
    ...(gift.test ? ['This was a test gift. No money moved.', ''] : []),
    `Thank you. ${fund.holder} received your ${
      gift.monthly ? 'monthly ' : ''
    }gift of **${money(gift.total)}** on ${day(gift.at)}${
      fund.holder == fund.title ? '' : `, for ${fund.title}`
    }.`,
    ...(gift.covered
      ? ['', `It includes ${money(gift.covered)} you added to cover the fee.`]
      : []),
    '',
    fund.statement,
    '',
    'Keep this letter as your receipt.',
    ...(gift.monthly && cancel
      ? [
        '',
        `It repeats each month. You can [change or cancel your monthly gift](${cancel}) at any time.`,
      ]
      : []),
  ].join('\n'),
})

/** A donor's statement of one calendar year's gifts, oldest first, with the
 * total, as a receipt for the whole year.
 *
 * ```ts
 * import { statement } from '@yaks/platform/giving'
 * import { equal } from '@yaks/testing'
 * let fund = { title: 'Roof', holder: 'Grace Hall Inc.', amounts: [], statement: 'Nothing given.' }
 * let got = statement(fund, 2026, [
 *   { total: 2500, covered: 0, at: '2026-12-01T00:00:00Z', monthly: true },
 *   { total: 1000, covered: 0, at: '2026-02-01T00:00:00Z', monthly: false },
 * ])
 * equal(got.title, 'Your 2026 giving statement from Grace Hall Inc.')
 * equal(got.body.includes('- February 1, 2026: $10.00\n- December 1, 2026: $25.00'), true)
 * equal(got.body.includes('**Total for 2026: $35.00**'), true)
 * ```
 */
export let statement = (fund: Fund, year: number, gifts: Received[]) => {
  let sorted = gifts.toSorted((a, b) => a.at.localeCompare(b.at))
  let total = sorted.reduce((n, g) => n + g.total, 0)
  return {
    title: `Your ${year} giving statement from ${fund.holder}`,
    body: [
      `Thank you for your gifts to ${fund.title} in ${year}. ${fund.holder} received:`,
      '',
      ...sorted.map((g) => `- ${day(g.at)}: ${money(g.total)}`),
      '',
      `**Total for ${year}: ${money(total)}**`,
      '',
      fund.statement,
      '',
      'Keep this letter with your tax records.',
    ].join('\n'),
  }
}

/** A dollar input in whole cents, with validation shared by the page and its door. */
export let centsOf = (input: unknown) => {
  let value = String(input ?? '').trim()
  if (!/^(?:[0-9]{1,5}(?:[.][0-9]{0,2})?|[.][0-9]{1,2})$/.test(value)) {
    return NaN
  }
  let [dollars, cents = ''] = value.split('.')
  return Number(dollars) * 100 + Number(cents.padEnd(2, '0'))
}

export let suggested = (input: string, minimum: number) => {
  let amounts = [...new Set(input.split(',').map(centsOf))]
  return amounts.length <= 6 &&
      amounts.every((cents) => cents >= minimum && cents <= MOST)
    ? amounts
    : null
}

export type Choice = {
  amount: string
  monthly: boolean
  cover: boolean
  key: string
}
export type Rates = { card: Costs['card']; recurring?: number; minimum: number }

export let priceOf = (choice: Omit<Choice, 'key'>, rates: Rates) =>
  charge(
    { ...choice, cents: centsOf(choice.amount) },
    rates.card,
    rates.minimum,
    rates.recurring,
  )

export let totalOf = (choice: Omit<Choice, 'key'>, rates: Rates) => {
  let price = priceOf(choice, rates)
  if ('refused' in price) return ''
  let { covered, total } = price.charge
  return `${covered ? `${money(covered)} added · ` : ''}${money(total)} total${
    choice.monthly ? ' per month' : ''
  }`
}
