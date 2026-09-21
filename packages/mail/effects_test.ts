// The outbound half as a host composes it: a transport nobody can build is a
// graph whose letters wait, never a host that will not come up.

import { assert, assertEquals } from '@std/assert'
import { effects, post } from './effects.ts'
import type { Transport } from './options.ts'

let quietly = <T>(body: () => T): [T, unknown[]] => {
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[1])
  try {
    return [body(), warned]
  } finally {
    console.warn = warn
  }
}

Deno.test('a transport that is named and complete is the one watch', () => {
  let [watches] = quietly(() => effects(null, { sender: { via: 'stash' } }))
  assertEquals(watches.map((w) => w.comp), ['mail'])
})

Deno.test('no sender named is no watch, and nothing said about it', () => {
  let [watches, warned] = quietly(() => effects(null, {}))
  assertEquals(watches, [])
  assertEquals(warned, [])
})

Deno.test('credentials that have not arrived take the watch, not the host', () => {
  let said = post({ via: 'cloudflare', account: 'a' } as Transport)
  assertEquals(said.sender, undefined)
  assert(said.waiting?.startsWith('waiting for credentials'), `${said.waiting}`)
  let [watches, warned] = quietly(() =>
    effects(null, { sender: { via: 'cloudflare', account: 'a' } as Transport })
  )
  assertEquals(watches, [])
  assert(String(warned[0]).includes('waiting for credentials'), `${warned[0]}`)
})

Deno.test('a sender nothing implements is a refusal, said rather than thrown', () => {
  let said = post({ via: 'carrier-pigeon' } as unknown as Transport)
  assertEquals(said.sender, undefined)
  assert(said.waiting?.includes('"carrier-pigeon"'), `${said.waiting}`)
})
