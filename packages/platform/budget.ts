// A space's monthly model and voice budget as a person reads it, the same on
// the box's admin_budget and the platform admin's Operator (workers/yak
// budget.ts).
import { line } from '@yaks/query'

/** The Free plan's monthly allowance, as set by the platform's owner. */
export let FREE_BUDGET_QUERY = line`.space.slug=yak&?free_ai_budget`

export let freeBudgetOf = (
  row: { entity: object; free_ai_budget?: unknown } | undefined,
): number | null =>
  (row?.free_ai_budget as { dollars?: number } | undefined)?.dollars ?? null

export type FreeBudget = { tier: 'free'; dollars: number; from: string }

/** The dollars set on a space, null where its plan's stands, the limit it
 * answers to, what it spent this month, and what is left of its starter as
 * the month began. */
export type SpaceBudget = {
  space: string
  dollars: number | null
  limit: number
  spent: number
  starter: number
}

// Dollars to the cent, as a person reads them.
let usd = (n: number) => `$${n.toFixed(2)}`

export let freeBudgetLine = (b: FreeBudget): string =>
  `Free plan: ${usd(b.dollars)} a month (from ${b.from} UTC)`

export let budgetLines = (b: SpaceBudget): string[] => [
  `${b.space}: ${usd(b.limit)} a month (${
    b.dollars == null ? "its plan's" : 'set by the platform'
  })`,
  `spent    ${usd(b.spent)} this month`,
  `starter  ${usd(b.starter)} left as the month began`,
]
