import { equal, test } from '@yaks/testing'
import type { VNode } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { installing, textsCard, voiceCard } from './operator-page.ts'
import { offered } from './speech.ts'

let consent = { number: '+12695550142', at: '2026-11-01T00:00:00Z' } as never
let drawn = (card: VNode) => parseHTML(renderToString(card)).document

test('the texts card names the numbers to text and call, to anyone', () => {
  let N = '+18663141594'
  let card = (agreed: unknown, from?: string, call?: string) =>
    drawn(textsCard('/manage/x/operator', agreed as never, from, call))
  let link = (at: Document, scheme: string) => {
    let a = at.querySelector(`a[href^="${scheme}:"]`)
    return a && [a.getAttribute('href'), a.textContent]
  }
  let says = (at: Document) => at.querySelector('#texts')!.textContent!
  let both = card(consent, N, N)
  equal(link(both, 'sms'), [`sms:${N}`, 'Text'])
  equal(link(both, 'tel'), [`tel:${N}`, '866-314-1594'])
  equal(
    says(both).includes(
      'Text or call 866-314-1594 to reach your Operator.',
    ),
    true,
  )
  let stranger = card(null, N, N)
  equal(link(stranger, 'tel'), [`tel:${N}`, '866-314-1594'])
  equal(says(stranger).includes('from the mobile number you agree'), true)
  equal(link(card(consent, N), 'tel'), null)
  equal(says(card(consent, N)).includes('Text 866-314-1594 to reach'), true)
  let none = card(consent)
  equal(link(none, 'sms'), null)
  equal(
    says(none).includes('reply to the number your welcome text came from.'),
    true,
  )
})

test('a number agreed to changes behind a button; without one the field shows', () => {
  let at = (agreed: unknown) =>
    drawn(textsCard('/manage/x/operator', agreed as never))
  let shown = (doc: Document) =>
    !doc.querySelector('#texts-number')!.closest('[hidden]')
  let agreed = at(consent)
  equal(agreed.querySelector('[data-reveal]')?.textContent, 'Change number')
  equal(shown(agreed), false)
  let stop = agreed.querySelector('button[form="texts-stop"]')!
  equal(stop.textContent, 'Stop texts')
  equal(
    agreed.querySelector('#texts-stop [name=stop]')?.getAttribute('value'),
    '1',
  )
  equal(agreed.querySelector('#texts')?.getAttribute('data-save'), 'texts')
  let fresh = at(null)
  equal(fresh.querySelector('[data-reveal]'), null)
  equal(shown(fresh), true)
  equal(fresh.querySelector('[type=submit]'), null)
  equal(
    fresh.querySelector('[name=agreed] + span')!.textContent!.endsWith(
      "Agreeing isn't required to use yaks.app.",
    ),
    true,
  )
})

test('the voice card posts to the page, and plays each sample from it', () => {
  let at = '/manage/x/operator'
  let env = { DEEPGRAM_API_KEY: 'a', OPENAI_VOICE_KEY: 'b' }
  let page = drawn(voiceCard(at, 'Elihu', offered(env, {})))
  let form = page.querySelector('form#voice')!
  equal(form.getAttribute('action'), `${at}?voice=1`)
  equal(form.getAttribute('data-save'), 'voice')
  equal(
    form.querySelector('[data-sample]')?.getAttribute('data-sample'),
    `${at}?sample=aura-2-draco-en`,
  )
  equal(form.textContent!.includes('How Elihu sounds'), true)
})

test('a space installs as its Operator, wearing its logo where it has one', async () => {
  let sha = 'a'.repeat(64)
  let icons = async (logo: unknown) => {
    let space = { slug: 'ada', title: 'Ada', operator: 'Jeeves', logo }
    let made = await installing(space as never).json()
    return [made.short_name, made.icons.map((i: { src: string }) => i.src)]
  }
  equal(await icons(null), ['Jeeves', ['/connector-512.png']])
  equal(await icons({ sha, type: 'image/png' }), [
    'Jeeves',
    [`/manage/ada/logo/${sha}`],
  ])
})
