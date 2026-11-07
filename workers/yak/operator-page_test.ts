import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import type { VNode } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { textsCard, voiceCard } from './operator-page.ts'
import { modelOf, offered } from './speech.ts'

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

let on = { DEEPGRAM_API_KEY: 'a', OPENAI_VOICE_KEY: 'b' }
let card = (
  voice?: string,
  voice_model?: string,
  env: object = on,
  voice_speed?: string,
) =>
  drawn(voiceCard(
    '/manage/x/operator',
    { operator: 'Elihu' },
    offered(env, { voice, voice_model, voice_speed }),
  ))
// Each choice a field offers, by the name it shows, and the one checked.
let names = (at: Document, field: string) =>
  [...at.querySelectorAll(`[name=${field}]`)]
    .map((i) => i.closest('label')!.querySelector('b')!.textContent)
let picked = (at: Document, field: string) =>
  at.querySelector(`[name=${field}]:checked`)?.getAttribute('value')

test('the voice card offers a few voices, the butler-like first, with the pick checked', () => {
  equal(names(card(), 'voice'), [
    'Draco',
    'Pandora',
    'Cedar',
    'Marin',
    'Ash',
    'Coral',
  ])
  equal(picked(card(), 'voice'), 'cedar')
  equal(
    picked(card(undefined, undefined, { DEEPGRAM_API_KEY: 'a' }), 'voice'),
    'aura-2-draco-en',
  )
  equal(
    card().querySelector('[value="aura-2-draco-en"]')?.getAttribute(
      'data-ways',
    ),
    'claude-haiku-5-5 claude-sonnet-5-5',
  )
  // A voice picked before and not offered still shows, checked.
  equal(picked(card('aura-2-zeus-en'), 'voice'), 'aura-2-zeus-en')
  equal(names(card(undefined, undefined, { DEEPGRAM_API_KEY: 'a' }), 'voice'), [
    'Draco',
    'Pandora',
  ])
})

test('the voice card says each way of answering plainly, the realtime one only where its provider is on', () => {
  equal(names(card(), 'voice_model'), [
    'Quickest',
    'Conversational',
    'Quick',
    'Thorough',
  ])
  equal(
    names(card(undefined, undefined, { DEEPGRAM_API_KEY: 'a' }), 'voice_model'),
    [
      'Quick',
      'Thorough',
    ],
  )
  equal(picked(card(), 'voice_model'), 'gpt-realtime-2.1-mini')
  equal(picked(card('aura-2-draco-en'), 'voice_model'), 'claude-haiku-5-5')
  equal(
    names(card('cedar', 'gpt-realtime-2.1'), 'voice_model').at(-1),
    'As set before',
  )
})

test('the voice card offers a few speeds, Normal until another is picked', () => {
  equal(names(card(), 'voice_speed'), ['Relaxed', 'Normal', 'Brisk'])
  equal(picked(card(), 'voice_speed'), 'normal')
  equal(
    picked(card(undefined, undefined, on, 'relaxed'), 'voice_speed'),
    'relaxed',
  )
})

test('a talking model is picked only with one of its own voices', () => {
  equal(modelOf('gpt-realtime-2.1', 'cedar'), 'gpt-realtime-2.1')
  equal(modelOf('claude-haiku-5-5', 'aura-2-draco-en'), 'claude-haiku-5-5')
  assertThrows(
    () => modelOf('gpt-realtime-2.1', 'aura-2-draco-en'),
    Error,
    'can’t speak in this voice',
  )
  assertThrows(
    () => modelOf('gpt-realtime-2.1', 'fable'),
    Error,
    'can’t speak in this voice',
  )
  assertThrows(() => modelOf('gpt-9', 'cedar'), Error, 'ways listed')
})
