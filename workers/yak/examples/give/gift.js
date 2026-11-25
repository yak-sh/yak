// The donor's choice as a vocabulary: no DOM, no network. The page asks the
// platform what covering the fee adds, so the amount shown is the amount
// charged.

/** Cents as dollars: `$25`, or `$25.50` when there are cents. */
export let money = (cents) => {
  let d = Number(cents ?? 0) / 100
  return `$${
    d.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(d) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  }`
}

/** The fund's suggested amounts, in cents, off its comma-separated row. */
export let amounts = (fund) =>
  String(fund?.fund?.amounts_cents ?? '').split(',')
    .map((a) => Number(a.trim()))
    .filter((a) => Number.isInteger(a) && a > 0)

/** Dollars a donor typed, as whole cents; 0 for anything that is not money. */
export let typed = (text) => {
  let d = Number(String(text ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(d) && d > 0 ? Math.round(d * 100) : 0
}

/** What the giving door is posted. */
export let asked = (choice) => ({
  fund: choice.fund,
  cents: choice.cents,
  monthly: !!choice.monthly,
  cover: !!choice.cover,
  success: '?thanks=1',
  cancel: '',
})

/** The owner's totals over gift rows: everything, this year, how many gifts
 * and donors, and how many give monthly. */
export let totals = (gifts, year = new Date().getUTCFullYear()) => {
  let sum = (rows) => rows.reduce((n, r) => n + (r.gift?.total_cents ?? 0), 0)
  return {
    all: sum(gifts),
    year: sum(gifts.filter((r) => r.gift?.at?.startsWith(`${year}-`))),
    gifts: gifts.length,
    donors: new Set(gifts.map((r) => r.gift?.email).filter(Boolean)).size,
    monthly: new Set(
      gifts.filter((r) => r.gift?.per == 'month').map((r) => r.gift?.payer),
    ).size,
  }
}
