import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { sendable } from '@yaks/mail'
import { CallError } from '@yaks/tools/errors'

export let CONTRACTS = '/api/support-contracts'
export let CONTRACT_REQUEST = '/operator/support-contract-request'

export type Terms = {
  annual: number
  onboarding: number
  monthly: number
  email: string
  phone: string
  start: string
  renewal: string
}

export type Contract = Terms & { space: string; provider: string }
export let contractEid = (space: string) =>
  derivedEid(`support-contract|${space}`)
export type TimeEntry = {
  contract: string
  minutes: number
  day: string
  note: string
}
export type Billing = {
  subscription: string
  invoice?: string
  /** A connected account when that account owns the billing objects. */
  account?: string
}

export let dayOf = (now: number) => new Date(now).toISOString().slice(0, 10)

let day = (value: string) => {
  let at = Date.parse(value)
  return /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(at) &&
    dayOf(at) == value
}

let units = (field: string, value: string, scale: number) => {
  let amount = Math.round(Number(value) * scale)
  if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(amount)) {
    throw new CallError(
      field,
      'Enter a non-negative number with up to two decimal places.',
    )
  }
  return amount
}

export let termsOf = (get: (key: string) => string): Terms => {
  let annual = units('annual', get('annual'), 100)
  let onboarding = units('onboarding', get('onboarding'), 100)
  let monthly = units('hours', get('hours'), 60)
  let email = get('email').trim()
  let phone = get('phone').trim()
  let start = get('start'), renewal = get('renewal')
  if (annual < 50) {
    throw new CallError('annual', 'The annual fee must be at least $0.50.')
  }
  if (onboarding > 0 && onboarding < 50) {
    throw new CallError('onboarding', 'Enter zero or at least $0.50.')
  }
  if (email && !sendable(email)) {
    throw new CallError('email', 'Enter a contact email address.')
  }
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new CallError(
      'phone',
      'Enter the phone number with its country code, such as +12695550100.',
    )
  }
  if (!email && !phone) {
    throw new CallError('email', 'Enter a contact email or phone number.')
  }
  if (!day(start) || !day(renewal) || start >= renewal) {
    throw new CallError(
      'renewal',
      'Enter a start date and a later renewal date.',
    )
  }
  return { annual, onboarding, monthly, email, phone, start, renewal }
}

export let entryOf = (
  get: (key: string) => string,
  eid: string,
  contract: Contract,
  today: string,
): TimeEntry => {
  let minutes = Number(get('minutes'))
  let note = get('note').trim()
  let at = get('day') || today
  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    throw new CallError('minutes', 'Enter a positive whole number of minutes.')
  }
  if (!note) throw new CallError('note', 'Describe the work.')
  if (!day(at) || at < contract.start || at > today) {
    throw new CallError(
      'day',
      'Use a day between the contract start and today.',
    )
  }
  return { contract: eid, minutes, day: at, note }
}

export let monthlyHours = (
  contract: Terms,
  entries: TimeEntry[],
  today: string,
) => {
  let month = today.slice(0, 7)
  let used = entries.filter((e) =>
    e.day.startsWith(month) && e.day >= contract.start && e.day <= today
  ).reduce((total, e) => total + e.minutes, 0)
  return {
    used,
    left: today < contract.start ? 0 : Math.max(0, contract.monthly - used),
  }
}

export let hours = (minutes: number) =>
  (minutes / 60).toLocaleString('en-US', { maximumFractionDigits: 2 })

export let requestAsk = (
  recipient: string,
  request: {
    id: string
    space: string
    name: string
    replyTo: string
    words: string
  },
): Bundle => {
  let title = `Support request from ${request.space}`
  let question = [
    title,
    `From ${request.name}${request.replyTo ? ` <${request.replyTo}>` : ''}`,
    request.words,
  ].join('\n\n')
  return {
    entity: { eid: derivedEid(`support-contract-request|${request.id}`) },
    task: { status: 'open' },
    filed: { assignee: recipient },
    doc: { title },
    decision: {
      question,
      choices: [{
        label: 'Handled',
        description: 'I took care of this request.',
      }],
    },
  }
}
