import { equal, test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { textsCard, voiceCard } from './operator-page.ts'

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

test('the voice card lists the butler-like voices first, with the pick checked', () => {
  let card = voiceCard('/manage/x/operator', 'Elihu')
  let names = [...card.matchAll(/<b>(\w+)<\/b>/g)].map((m) => m[1])
  equal(names.slice(0, 2), ['Draco', 'Pandora'])
  assertStringIncludes(card, 'value="aura-2-draco-en" checked')
  assertStringIncludes(
    voiceCard('/manage/x/operator', 'Elihu', 'aura-2-zeus-en'),
    'value="aura-2-zeus-en" checked',
  )
})
