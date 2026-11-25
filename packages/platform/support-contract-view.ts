import { type ComponentChildren, h } from 'preact'
import { Button, Card, Field, Form, Group } from '@yaks/ui/parts'
import {
  type Billing,
  type Contract,
  CONTRACTS,
  hours,
  type TimeEntry,
} from './support-contract.ts'
import { nextRenewal, type Setup } from './support-contract-service.ts'

export type Usage = { used: number; left: number; entries: TimeEntry[] }

let hidden = (name: string, value: string) =>
  h('input', { type: 'hidden', name, value })

let form = (
  fields: Record<string, string>,
  ...children: ComponentChildren[]
) =>
  h(Form, { method: 'post', action: CONTRACTS }, [
    hidden('browser', '1'),
    ...Object.entries(fields).map(([name, value]) => hidden(name, value)),
    ...children,
  ])

let field = (
  label: string,
  name: string,
  type: string,
  value?: string,
  required = true,
  step?: string,
) =>
  h(Form.Field, null, [
    h(Form.Label, { for: 'contract-' + name }, label),
    h(Field, {
      id: 'contract-' + name,
      name,
      type,
      value,
      required,
      step,
      placeholder: '',
    }),
  ])

export let supportHours = (usage: Pick<Usage, 'used' | 'left'>) =>
  `${hours(usage.used)} hours used · ${hours(usage.left)} hours left this month`

let logForm = (space: string, provider: boolean, today?: string) =>
  form(
    { op: 'log', space, ...provider ? { provider_log: '1' } : {} },
    field('Work date', 'day', 'date', today, false),
    field('Minutes worked', 'minutes', 'number'),
    field('Work note', 'note', 'text'),
    h(Button, { type: 'submit' }, 'Log time'),
  )

export let contactCard = (
  space: string,
  support: Usage & { contract: Contract; providerName: string },
  at: { id: string; sent?: boolean; log?: boolean },
) => {
  let { contract, providerName } = support
  return h(Card, { id: 'contact-support' }, [
    h(Card.Head, null, h(Card.Title, null, `Contact ${providerName}`)),
    h('p', null, supportHours(support)),
    h('p', null, [
      contract.phone
        ? h('a', { href: `tel:${contract.phone}` }, `Call ${contract.phone}`)
        : null,
      contract.phone && contract.email ? ' · ' : null,
      contract.email
        ? h(
          'a',
          { href: `mailto:${contract.email}` },
          `Email ${contract.email}`,
        )
        : null,
    ]),
    at.sent
      ? h('p', { role: 'status' }, `Request sent to ${providerName}.`)
      : null,
    at.log ? logForm(space, true) : form(
      { op: 'request', space, id: at.id },
      h(Form.Field, null, [
        h(
          Form.Label,
          { for: 'contract-message' },
          `Send a request to ${providerName}`,
        ),
        h(Field, {
          id: 'contract-message',
          lines: true,
          name: 'message',
          placeholder: '',
          required: true,
        }),
      ]),
      h(Button, { type: 'submit' }, 'Send request'),
    ),
  ])
}

export let contractAdmin = (
  space: string,
  contract: Contract | undefined,
  usage: (Usage & { providerName: string; billing?: Billing }) | undefined,
  subscription: string | undefined,
  today: string,
  retry?: Setup,
) => {
  let terms = retry?.terms ?? contract
  return h('section', { id: 'support-contract' }, [
    h(Group, null, 'Support contract'),
    usage && h('p', null, [usage.providerName, ' · ', supportHours(usage)]),
    usage?.entries.length
      ? h(
        'ul',
        null,
        usage.entries.map((e) =>
          h('li', null, `${e.day} · ${hours(e.minutes)} h · ${e.note}`)
        ),
      )
      : null,
    form(
      { op: 'set', space },
      field(
        'Annual fee (USD)',
        'annual',
        'number',
        terms && String(terms.annual / 100),
        true,
        '0.01',
      ),
      field(
        'One-time onboarding fee (USD)',
        'onboarding',
        'number',
        terms && String(terms.onboarding / 100),
        true,
        '0.01',
      ),
      field(
        'Included hours per month',
        'hours',
        'number',
        terms && hours(terms.monthly).replaceAll(',', ''),
        true,
        '0.01',
      ),
      field('Direct email', 'email', 'email', terms?.email, false),
      field(
        'Direct phone (with country code)',
        'phone',
        'tel',
        terms?.phone,
        false,
      ),
      field(
        'Provider’s yaks.app account',
        'provider',
        'email',
        undefined,
        false,
      ),
      field('Start date', 'start', 'date', terms?.start ?? today),
      field(
        'Renewal date',
        'renewal',
        'date',
        retry?.terms.renewal ?? (terms && nextRenewal(terms.renewal, today)),
      ),
      !usage?.billing
        ? h(Form.Field, null, [
          h(Form.Label, { for: 'contract-billing' }, 'Billing'),
          h(Field, {
            id: 'contract-billing',
            name: 'billing',
            choose: true,
            value: retry?.bill ? 'platform' : 'terms',
          }, [
            h('option', { value: 'terms' }, 'Save terms only'),
            h('option', { value: 'platform' }, 'Bill with the yearly plan'),
          ]),
        ])
        : null,
      ...subscription && !retry?.to ? [] : [
        field(
          'Billing email (to start a yearly plan)',
          'billing_email',
          'email',
          retry?.to?.email,
          false,
        ),
        field('Billing name', 'billing_name', 'text', retry?.to?.name, false),
      ],
      h(
        Button,
        { type: 'submit' },
        retry
          ? 'Retry billing'
          : contract
          ? 'Save terms'
          : 'Set terms and invoice',
      ),
    ),
    contract && logForm(space, false, today),
  ])
}
