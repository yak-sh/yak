// Which duty roles a command hands to a thread of its own: the ones no live
// process is serving.

import { assertEquals } from '@std/assert'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effectDoc, POOL, take } from '@yaks/effects'
import { dutiesOf, rolesOf, unserved } from './local.ts'

let pooled = loadVocab([effectDoc])
let config = { plugins: ['@yaks/wake', '@yaks/doc', { use: '@yaks/mail' }] }
// The plugins here with a `./service`.
let has = (plugin: string) => plugin != '@yaks/doc'
let NOW = Date.parse('2026-09-25T12:00:00Z')

// A graph, with the leases named held by `server` until a minute from now, or
// held and lapsed where the name is prefixed `-`.
let leased = async (...names: string[]) => {
  let g = graph({ storage: ram(pooled), vocab: pooled })
  for (let name of names) {
    let gone = name.startsWith('-')
    await take(g, gone ? name.slice(1) : name, {
      holder: 'server',
      now: () => gone ? NOW - 120_000 : NOW,
    })
  }
  return g
}

let idle = async (names: string[], mine: string[] = [], g?: Graph) => {
  let at = g ?? await leased(...names)
  return unserved(at, dutiesOf(at.vocab, config, mine, has), 'me', NOW)
}

Deno.test('a duty role nobody live is serving is the thread’s to take', async () => {
  let all = ['effects', '@yaks/wake', '@yaks/mail']
  assertEquals(await idle([]), all)
  assertEquals(await idle([`${POOL}/server`]), ['@yaks/wake', '@yaks/mail'])
  assertEquals(await idle(['@yaks/mail', '-@yaks/wake']), [
    'effects',
    '@yaks/wake',
  ])
  // What this process serves itself is not handed on.
  assertEquals(await idle([], ['@yaks/wake']), ['effects', '@yaks/mail'])
})

Deno.test('a graph keeping no pool has no pool to hand on', async () => {
  let bare = loadVocab([{ $defs: {} }])
  let g = graph({ storage: ram(bare), vocab: bare })
  assertEquals(await idle([], [], g), ['@yaks/wake', '@yaks/mail'])
  // …so its effects run where they are committed.
  assertEquals(rolesOf({}, false), ['graph', 'effects'])
  assertEquals(rolesOf({ roles: ['web'] }, true), ['graph', 'web'])
})
