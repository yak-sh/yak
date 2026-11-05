import { equal, test } from '@yaks/testing'
import { assertStringIncludes, assertThrows } from '@std/assert'
import { textsCard, voiceCard } from './operator-page.ts'
import { modelOf, offered } from './speech.ts'

let consent = { number: '+12695550142', at: '2026-11-01T00:00:00Z' } as never

test('the texts card names the number to text as an sms: link', () => {
  assertStringIncludes(
    textsCard('/manage/x/operator', consent, '+18663141594'),
    'text <a href="sms:+18663141594">866-314-1594</a>.',
  )
  assertStringIncludes(
    textsCard('/manage/x/operator', consent),
    'reply to the number your welcome text came from.',
  )
})

let on = { DEEPGRAM_API_KEY: 'a', OPENAI_VOICE_KEY: 'b' }
let card = (
  voice?: string,
  voice_model?: string,
  env: object = on,
  voice_speed?: string,
) =>
  voiceCard(
    '/manage/x/operator',
    { operator: 'Elihu' },
    offered(env, { voice, voice_model, voice_speed }),
  )
let names = (html: string, field: string) =>
  [...html.matchAll(
    new RegExp(`name="${field}"[^>]*><span><b>([\\w ]+)</b>`, 'g'),
  )]
    .map((m) => m[1])

test('the voice card offers a few voices, the butler-like first, with the pick checked', () => {
  equal(names(card(), 'voice'), [
    'Draco',
    'Pandora',
    'Cedar',
    'Marin',
    'Ash',
    'Coral',
  ])
  assertStringIncludes(
    card(),
    'value="aura-2-draco-en" data-ways="claude-haiku-5-5 claude-sonnet-5-5" checked',
  )
  // A voice picked before and not offered still shows, checked.
  assertStringIncludes(
    card('aura-2-zeus-en'),
    'value="aura-2-zeus-en" data-ways',
  )
  equal(names(card(undefined, undefined, { DEEPGRAM_API_KEY: 'a' }), 'voice'), [
    'Draco',
    'Pandora',
  ])
})

test('the voice card says each way of answering plainly, the realtime one only where its provider is on', () => {
  equal(names(card(), 'voice_model'), ['Quickest', 'Quick', 'Thorough'])
  equal(
    names(card(undefined, undefined, { DEEPGRAM_API_KEY: 'a' }), 'voice_model'),
    [
      'Quick',
      'Thorough',
    ],
  )
  assertStringIncludes(card(), 'value="claude-haiku-5-5" checked')
  equal(
    names(card('cedar', 'gpt-realtime-2.1'), 'voice_model').at(-1),
    'As set before',
  )
})

test('the voice card offers a few speeds, Brisk until another is picked', () => {
  equal(names(card(), 'voice_speed'), ['Relaxed', 'Normal', 'Brisk'])
  assertStringIncludes(card(), 'value="brisk" checked')
  assertStringIncludes(
    card(undefined, undefined, on, 'relaxed'),
    'value="relaxed" checked',
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
