import { test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { textsCard } from './operator-page.ts'

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
