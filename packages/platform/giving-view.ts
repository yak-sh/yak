import { createElement as h } from 'react'
import { Button, Card, Field, Form, Notice } from '@yaks/ui/parts'
import { type Choice, type Fund, money, type Rates, totalOf } from './giving.ts'

export type Tally = { gifts: number; cents: number }

let radio = (value: string, label: string, checked: boolean) =>
  h(
    'label',
    null,
    h('input', { type: 'radio', name: 'frequency', value, checked }),
    ' ',
    label,
  )

export let donorForm = (
  fund: Fund,
  eid: string,
  route: string,
  choice: Choice,
  rates: Rates,
  provider: string,
  available: boolean,
  error?: string,
) =>
  h(
    Card,
    null,
    error ? h(Notice, { role: 'alert' }, error) : null,
    h(
      'form',
      {
        className: 'Page_Form',
        method: 'post',
        action: route,
        'data-giving': JSON.stringify(rates),
      },
      h('input', { type: 'hidden', name: 'key', value: choice.key }),
      h('input', { type: 'hidden', name: 'fund', value: eid }),
      h(
        'fieldset',
        null,
        h('legend', null, 'Gift frequency'),
        radio('once', 'One time', !choice.monthly),
        '　',
        radio('month', 'Monthly', choice.monthly),
      ),
      h(
        'label',
        null,
        'Amount (USD)',
        h(Field, {
          name: 'amount',
          placeholder: '0.00',
          value: choice.amount,
          inputMode: 'decimal',
          required: true,
          autocomplete: 'off',
        }),
      ),
      h(
        'div',
        { hidden: true, 'data-amounts': '' },
        fund.amounts.map((amount) =>
          h(Button, {
            type: 'button',
            'data-amount': (amount / 100).toFixed(2),
          }, money(amount))
        ),
      ),
      h(
        'label',
        null,
        h('input', { type: 'checkbox', name: 'cover', checked: choice.cover }),
        ' Cover estimated payment fees',
      ),
      h(
        'output',
        { 'aria-live': 'polite', 'data-gift-total': '' },
        totalOf(choice, rates),
      ),
      h(Button, {
        type: 'submit',
        name: 'act',
        value: 'review',
        disabled: !available,
      }, 'Review gift'),
      h(
        Form.Hint,
        null,
        `Pay through ${provider} with a card, Apple Pay, or Google Pay where available.`,
      ),
    ),
  )

export let reviewForm = (
  route: string,
  eid: string,
  choice: Choice,
  total: number,
  covered: number,
  provider: string,
) =>
  h(
    Card,
    null,
    h(
      'p',
      null,
      h(
        'strong',
        null,
        `${money(total)}${choice.monthly ? ' each month' : ''}`,
      ),
      covered ? ` including ${money(covered)} to cover estimated fees.` : null,
    ),
    h(
      'form',
      { className: 'Page_Form', method: 'post', action: route },
      h('input', { type: 'hidden', name: 'fund', value: eid }),
      h('input', { type: 'hidden', name: 'key', value: choice.key }),
      h('input', { type: 'hidden', name: 'amount', value: choice.amount }),
      h('input', {
        type: 'hidden',
        name: 'frequency',
        value: choice.monthly ? 'month' : 'once',
      }),
      h('input', { type: 'hidden', name: 'priced', value: total }),
      choice.cover
        ? h('input', { type: 'hidden', name: 'cover', value: 'on' })
        : null,
      h(
        Button,
        { type: 'submit', value: 'checkout', name: 'act' },
        `Continue to ${provider}`,
      ),
      h('a', { href: `${route}?fund=${eid}` }, 'Edit gift'),
    ),
  )

export let fundForm = (
  fund: Fund | null,
  eid: string,
  manage: string,
  give: string,
  canLive: boolean,
) =>
  h(
    Card,
    null,
    h('h2', null, fund ? fund.title : 'New donation fund'),
    fund ? h('p', null, h('a', { href: give }, 'Open giving page')) : null,
    h(
      'form',
      { className: 'Page_Form', method: 'post', action: manage },
      h('input', { type: 'hidden', name: 'fund', value: eid }),
      h(
        'label',
        null,
        'Fund name',
        h(Field, {
          name: 'title',
          placeholder: '',
          value: fund?.title ?? '',
          required: true,
          maxLength: 120,
        }),
      ),
      h(
        'label',
        null,
        'Recipient’s legal name',
        h(Field, {
          name: 'holder',
          placeholder: '',
          value: fund?.holder ?? '',
          required: true,
          maxLength: 120,
        }),
      ),
      h(
        'label',
        null,
        'Suggested amounts (USD, separated by commas)',
        h(Field, {
          name: 'amounts',
          placeholder: '25, 50, 100',
          value: fund?.amounts.map((n) => n / 100).join(', ') || '25, 50, 100',
          required: true,
        }),
      ),
      h(
        'label',
        null,
        'Receipt statement',
        h(Field, {
          name: 'statement',
          placeholder: '',
          value: fund?.statement ?? '',
          lines: true,
          maxLength: 400,
        }),
      ),
      h(
        'label',
        null,
        'Payment mode',
        h(
          'select',
          { name: 'mode' },
          h(
            'option',
            { value: 'test', selected: !fund || fund.test === true },
            'Test',
          ),
          canLive
            ? h(
              'option',
              { value: 'live', selected: !!fund && !fund.test },
              'Live',
            )
            : null,
        ),
      ),
      h(Button, { type: 'submit', name: 'act', value: 'save' }, 'Save fund'),
    ),
  )

export let totalsView = (
  manage: string,
  year: number,
  today: number,
  live: Tally,
  test: Tally,
) =>
  h(
    Card,
    null,
    h('h2', null, 'Giving totals'),
    h(
      'form',
      { className: 'Page_Form', method: 'get', action: manage },
      h(
        'label',
        null,
        'Calendar year (UTC)',
        h(Field, {
          name: 'year',
          placeholder: '',
          type: 'number',
          min: 2020,
          max: today,
          value: String(year),
          required: true,
        }),
      ),
      h(Button, { type: 'submit' }, 'Show totals'),
    ),
    h('p', null, `${live.gifts} gifts · ${money(live.cents)} received`),
    h('p', null, `${test.gifts} test gifts · ${money(test.cents)} simulated`),
    year < today
      ? h(
        'form',
        { className: 'Page_Form', method: 'post', action: manage },
        h('input', { type: 'hidden', name: 'year', value: year }),
        h(
          Button,
          { type: 'submit', name: 'act', value: 'statements' },
          'Email year-end statements',
        ),
      )
      : h(
        Form.Hint,
        null,
        'Year-end statements are available after the calendar year ends.',
      ),
  )
