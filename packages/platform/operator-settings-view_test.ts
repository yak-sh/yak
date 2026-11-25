import { equal, test } from '@yaks/testing'
import {
  AT,
  operatorRows,
  operatorView,
  page,
} from './operator-settings_fixture_test.ts'

let N = '+18663141594'
let agreed = { number: '+12695550142', at: '2026-11-01T00:00:00Z' }

let texts = (texting: typeof agreed | null, from?: string, call?: string) =>
  page(operatorView({ from, call }), operatorRows({ texting }))

let link = (at: HTMLElement, scheme: string) => {
  let a = at.querySelector(`#texts a[href^="${scheme}:"]`)
  return a && [a.getAttribute('href'), a.textContent]
}
let says = (at: HTMLElement) => at.querySelector('#texts')!.textContent!

test('the texts card names the numbers to text and call, to anyone', () => {
  let both = texts(agreed, N, N)
  equal(link(both, 'sms'), [`sms:${N}`, 'Text'])
  equal(link(both, 'tel'), [`tel:${N}`, '866-314-1594'])
  equal(
    says(both).includes('Text or call 866-314-1594 to contact your Operator.'),
    true,
  )
  let stranger = texts(null, N, N)
  equal(link(stranger, 'tel'), [`tel:${N}`, '866-314-1594'])
  equal(says(stranger).includes('from the mobile number you agree'), true)
  equal(link(texts(agreed, N), 'tel'), null)
  equal(says(texts(agreed, N)).includes('Text 866-314-1594 to contact'), true)
  let none = texts(agreed)
  equal(link(none, 'sms'), null)
  equal(
    says(none).includes('reply to the number your welcome text came from.'),
    true,
  )
})

test('a number agreed to changes behind a button, beside Stop texts; without one the field shows', () => {
  let shown = (at: HTMLElement) =>
    !at.querySelector('#texts-number')!.closest('[hidden]')
  let on = texts(agreed)
  equal(on.querySelector('[data-reveal]')?.textContent, 'Change number')
  equal(shown(on), false)
  equal(on.querySelector('[data-stop-texts]')?.textContent, 'Stop texts')
  equal(on.querySelector('#texts')?.getAttribute('data-save'), 'texts')
  let fresh = texts(null)
  equal(fresh.querySelector('[data-reveal]'), null)
  equal(fresh.querySelector('[data-stop-texts]'), null)
  equal(shown(fresh), true)
  equal(
    fresh.querySelector('[name=agreed] + span')!.textContent!.endsWith(
      "Agreeing isn't required to use yaks.app.",
    ),
    true,
  )
})

test('the Operator goes by the name its settings hold, and its voice card plays each sample from the page', () => {
  let named = page(
    operatorView(),
    operatorRows({ settings: { name: 'Caleb', voice: 'marin' } }),
  )
  let form = named.querySelector('form#voice')!
  equal(form.getAttribute('data-save'), 'voice')
  equal(
    form.querySelector('[data-sample]')?.getAttribute('data-sample'),
    `${AT}?sample=draco`,
  )
  equal(form.textContent!.includes('How Caleb sounds'), true)
  equal(
    form.querySelector<HTMLInputElement>('[name=voice]:checked')?.value,
    'marin',
  )
  equal(
    named.querySelector<HTMLInputElement>('#name [name=name]')?.value,
    'Caleb',
  )
  let unnamed = page(operatorView(), operatorRows({ settings: {} }))
  equal(unnamed.textContent!.includes('Elihu is this space’s Operator.'), true)
})

test('alerts check the way chosen, else the way they go now, and offer this browser only where notifications are on', () => {
  let checked = (at: HTMLElement) =>
    at.querySelector<HTMLInputElement>('[name=channel]:checked')?.value
  let ways = (at: HTMLElement) =>
    [...at.querySelectorAll<HTMLInputElement>('[name=channel]')].map((i) =>
      i.value
    )
  let going = page(
    operatorView(),
    operatorRows({ alerting: { by: 'text', browsers: 0 } }),
  )
  equal([checked(going), ways(going)], ['text', ['text', 'email', 'updates']])
  let chosen = page(
    operatorView({ key: 'vapid' }),
    operatorRows({ alerting: { channel: 'updates', by: 'push', browsers: 2 } }),
  )
  equal([checked(chosen), ways(chosen)], ['updates', [
    'push',
    'text',
    'email',
    'updates',
  ]])
  equal(chosen.querySelector('[data-push]')?.getAttribute('data-push'), 'vapid')
  equal(
    chosen.querySelector('#alerts')!.textContent!.includes(
      'on the 2 browsers you allowed',
    ),
    true,
  )
})
