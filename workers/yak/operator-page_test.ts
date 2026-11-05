import { equal, test } from '@yaks/testing'
import { assertStringIncludes, assertThrows } from '@std/assert'
import { textsCard, voiceCard } from './operator-page.ts'
import { callModels, modelOf, voicesOn } from './speech.ts'

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
let card = (voice?: string, voice_model?: string, env: object = on) =>
  voiceCard(
    '/manage/x/operator',
    { operator: 'Elihu', voice, voice_model },
    voicesOn(env),
    callModels(env),
  )

test('the voice card lists the butler-like voices first, with the pick checked', () => {
  let names = [...card().matchAll(/<b>(\w+)<\/b>/g)].map((m) => m[1])
  equal(names.slice(0, 2), ['Draco', 'Pandora'])
  assertStringIncludes(card(), 'value="aura-2-draco-en" checked')
  assertStringIncludes(card('aura-2-zeus-en'), 'value="aura-2-zeus-en" checked')
})

test('the voice card lists each provider that is on, and the models that may answer', () => {
  let groups = (html: string) =>
    [...html.matchAll(/Voices_Group">(\w+)</g)].map((m) => m[1])
  equal(groups(card()), ['Deepgram', 'OpenAI'])
  equal(groups(card(undefined, undefined, { DEEPGRAM_API_KEY: 'a' })), [
    'Deepgram',
  ])
  assertStringIncludes(card(), 'value="claude-haiku-5-5" selected')
  assertStringIncludes(
    card('cedar', 'gpt-realtime-2.1-mini'),
    'value="gpt-realtime-2.1-mini" selected',
  )
})

test('a talking model is picked only with one of its own voices', () => {
  equal(modelOf('gpt-realtime-2.1', 'cedar'), 'gpt-realtime-2.1')
  equal(modelOf('claude-haiku-5-5', 'aura-2-draco-en'), 'claude-haiku-5-5')
  assertThrows(
    () => modelOf('gpt-realtime-2.1', 'aura-2-draco-en'),
    Error,
    'only in its own voices',
  )
  assertThrows(() => modelOf('gpt-9', 'cedar'), Error, 'models listed')
})
