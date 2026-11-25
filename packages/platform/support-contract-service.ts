import { type Bundle, mint } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { type Built, line, sub } from '@yaks/query'
import { CallError } from '@yaks/tools/errors'
import type { Plans, RecurringAddOn } from '@yaks/host/payments'
import {
  type Billing,
  type Contract,
  contractEid,
  dayOf,
  monthlyHours,
  type TimeEntry,
} from './support-contract.ts'

export type To = { email: string; name: string }
export type Setup = { terms: Contract; bill: boolean; to?: To }

export let current = (space: string) =>
  line`.entity.eid=${
    contractEid(space)
  }&?support_contract&?support_contract_billing&?support_contract_pending`
let contracts = line`.support_contract&?support_contract_billing`
let work = (today: string, contract?: string) =>
  line`.support_contract_time.day>=${
    today.slice(0, 7) + '-01'
  }&.support_contract_time.day<=${today}${
    sub(contract ? line`&.support_contract_time.contract=${contract}` : line``)
  }`

export let contractOf = (row?: Bundle) =>
  row?.support_contract as Contract | undefined
export let billingOf = (row?: Bundle) =>
  row?.support_contract_billing as Billing | undefined
let pendingOf = (row?: Bundle) =>
  row?.support_contract_pending as
    | { key: string; data: string }
    | undefined

export let pendingSetup = (row?: Bundle): Setup | undefined => {
  let pending = pendingOf(row)
  return pending && JSON.parse(pending.data) as Setup
}

export let hoursOf = (
  contract: Contract,
  time: Bundle[],
  today: string,
) => {
  let entries = time.map((r) => r.support_contract_time as TimeEntry)
  return { ...monthlyHours(contract, entries, today), entries }
}

/** Stripe owns renewal of the subscription item. The entered first renewal
 * defines the date to display in subsequent years, including leap years. */
export let nextRenewal = (renewal: string, today: string) => {
  let y = Math.max(Number(renewal.slice(0, 4)), Number(today.slice(0, 4)))
  let thisYear = inYear(renewal, y)
  return thisYear < today ? inYear(renewal, y + 1) : thisYear
}

let inYear = (day: string, year: number) => {
  let [, month, date] = day.split('-').map(Number)
  let last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return dayOf(Date.UTC(year, month - 1, Math.min(date, last)))
}

let validateBilling = (
  terms: Contract,
  had: Contract | undefined,
  billing: Billing | undefined,
  subscription: string,
  to: To | undefined,
  today: string,
) => {
  if (billing?.invoice && had && had.onboarding != terms.onboarding) {
    throw new CallError(
      'onboarding',
      'The one-time onboarding fee has already been invoiced.',
    )
  }
  if (subscription) return
  if (!to) {
    throw new CallError(
      'billing_email',
      'Enter the recipient for the yearly plan invoice.',
    )
  }
  if (terms.renewal <= today) {
    throw new CallError('renewal', 'The first renewal must be in the future.')
  }
  let anniversary = inYear(terms.start, Number(terms.start.slice(0, 4)) + 1)
  if (terms.renewal > anniversary) {
    throw new CallError(
      'renewal',
      'Set the first renewal within one year of the start date.',
    )
  }
}

let invoiceContract = async (
  plans: Plans,
  space: string,
  setup: Setup,
  subscription: string,
  payer: string,
  billing: Billing | undefined,
  create: (
    item: RecurringAddOn,
    to: To,
  ) => Promise<{ id: string; payer: string }>,
  invoiceTerms: { apex: string; due: number },
  today: string,
): Promise<Billing> => {
  let { terms, to } = setup
  if (!plans.invoicingOn?.() || !plans.addOn || !plans.invoiceOnce) {
    throw new CallError(
      'billing',
      'The platform needs its support-invoicing credential before it can set terms.',
    )
  }
  let item = {
    key: contractEid(space),
    name: 'Annual support contract',
    cents: terms.annual,
    start: terms.start,
    renewal: nextRenewal(terms.renewal, today),
  }
  if (subscription) {
    let no = await plans.addOn(subscription, item)
    if (no) throw new CallError('billing', no)
  } else {
    let made = await create(item, to!)
    subscription = made.id
    payer = made.payer
  }
  let invoice = billing?.invoice
  if (!invoice && terms.onboarding) {
    invoice = await plans.invoiceOnce({
      payer,
      key: item.key,
      cents: terms.onboarding,
      name: 'Support contract onboarding',
      due: invoiceTerms.due,
      tags: { space, apex: invoiceTerms.apex, purchase: 'support_onboarding' },
    })
  }
  return { subscription, ...invoice ? { invoice } : {} }
}

type Read = (query: Built) => Promise<Bundle[]>

export let oneContract = async (read: Read, space: string, today: string) => {
  let [row] = await read(current(space))
  let contract = contractOf(row)
  if (!contract) return null
  let eid = row.entity.eid
  let time = await read(work(today, eid))
  return {
    eid,
    contract,
    billing: billingOf(row),
    ...hoursOf(contract, time, today),
  }
}

export let allContracts = async (read: Read, today: string) => {
  let [rows, time] = await Promise.all([
    read(contracts),
    read(work(today)),
  ])
  if (!rows.length) return []
  let spaces = await read(
    line`.entity.eid=${rows.map((r) => contractOf(r)!.space)}&.space`,
  )
  let slugs = new Map(
    spaces.map((r) => [r.entity.eid, (r.space as { slug: string }).slug]),
  )
  return rows.flatMap((r) => {
    let contract = contractOf(r)!
    let slug = slugs.get(contract.space)
    return slug
      ? [{
        eid: r.entity.eid,
        slug,
        contract,
        billing: billingOf(r),
        ...hoursOf(
          contract,
          time.filter((t) =>
            (t.support_contract_time as TimeEntry).contract == r.entity.eid
          ),
          today,
        ),
      }]
      : []
  })
}

/** Save the intended terms before calling Stripe. Each provider operation
 * resumes from the corresponding Stripe object after a partial save. */
export let saveContract = async (
  apply: (row: Bundle) => Promise<unknown>,
  provider: Plans,
  space: string,
  row: Bundle | undefined,
  setup: Setup,
  sub: string,
  payer: string,
  create: (
    item: RecurringAddOn,
    to: To,
  ) => Promise<{ id: string; payer: string }>,
  invoiceTerms: { apex: string; due: number },
  today: string,
) => {
  let had = contractOf(row)
  let bill = billingOf(row)
  let pending = pendingOf(row)
  let entity = { eid: contractEid(space) }
  if (had && had.provider != setup.terms.provider) {
    throw new CallError('provider', 'This contract already has a provider.')
  }
  if (!setup.bill) {
    if (pending) {
      throw new CallError('billing', 'A previous save is waiting on billing.')
    }
    await apply({
      entity,
      support_contract: setup.terms,
      $was: {
        support_contract_pending: { key: null },
        support_contract: { provider: had ? token(had.provider) : null },
      },
    })
    return
  }
  validateBilling(setup.terms, had, bill, sub, setup.to, today)
  if (!sub && !provider.offers('pro', 'year')) {
    throw new CallError('billing', 'The yearly Pro plan is unavailable here.')
  }
  let data = JSON.stringify(setup)
  if (pending && pending.data != data) {
    throw new CallError(
      'billing',
      'A previous save is waiting on billing. Retry those terms first.',
    )
  }
  let key = pending?.key ?? mint()
  if (!pending) {
    try {
      await apply({
        entity,
        support_contract_pending: { key, data, space },
        $was: { support_contract_pending: { key: null } },
      })
    } catch (e) {
      if (!(e instanceof Stale)) throw e
      throw new CallError('billing', 'Another save is in progress. Try again.')
    }
  }
  let guard = { support_contract_pending: { key: token(key) } }
  try {
    let billed = await invoiceContract(
      provider,
      space,
      setup,
      sub,
      payer,
      bill,
      create,
      invoiceTerms,
      today,
    )
    await apply({
      entity,
      support_contract: setup.terms,
      support_contract_billing: billed,
      support_contract_pending: null,
      $was: guard,
    })
  } catch (e) {
    if (e instanceof Stale) return
    if (e instanceof CallError) {
      await apply({
        entity,
        support_contract_pending: null,
        $was: guard,
      }).catch((error) => {
        if (!(error instanceof Stale)) throw error
      })
    }
    throw e
  }
}
