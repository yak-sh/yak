import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, ToolCtx } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { sessionDoc } from './comp.ts'
import { hookSession, runs } from './tools.ts'

let vocab = loadVocab([docDoc, sessionDoc], [idKeywords])

// The store, as far as these tools read it: a list of bundles and the queries
// they answer. Each tool asks one thing, so the stub answers by prefix.
let ctx = (
  args: Record<string, unknown>,
  rows: Bundle[] = [],
  actor?: string,
) =>
  ({
    args,
    actor: actor ? { eid: actor } : null,
    graph: { vocab, address: () => new Map() },
    read: (q: string) =>
      rows.filter((b) =>
        Object.entries(b.$match ?? {}).every(([k]) => String(q).includes(k))
      ),
  }) as unknown as ToolCtx

// A row the stub answers for any query naming `on`.
let row = (b: Bundle, on: string): Bundle => ({ ...b, $match: { [on]: true } })

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('every session tool is declared and implemented', () => {
  assertEquals(loadTools(sessionDoc, runs).map((t) => t.name).sort(), [
    'claim_release',
    'claim_take',
    'hooks_install',
    'session_brief',
    'session_context',
    'session_wrap',
  ])
})

Deno.test('a claim is taken for whoever is asking', async () => {
  let [said] = await runs.claim_take!(
    [],
    ctx({ target: 't' }, [], 's'),
  ) as Bundle[]
  assertEquals(said.entity.eid, 't')
  assertEquals(comp(said, 'claim'), { session: 's' })
})

Deno.test('nobody asking and nobody named is a refusal, not a lock', async () => {
  let threw = await runs.claim_take!([], ctx({ target: 't' })).then(
    () => false,
    () => true,
  )
  assert(threw)
})

Deno.test('a release drops the component', async () => {
  let [said] = await runs.claim_release!([], ctx({ target: 't' })) as Bundle[]
  assertEquals(said.claim, null)
})

Deno.test('a hook payload names the session; anything else says nothing', () => {
  assertEquals(hookSession('{"session_id":"abc"}'), 'abc')
  assertEquals(hookSession('not json at all'), '')
  assertEquals(hookSession(undefined), '')
})

Deno.test('a session nobody has seen is minted, with its own heading', async () => {
  let said = await runs.session_context!(
    [],
    ctx({ hook: '{"session_id":"abc"}', actor: 'p1' }),
  ) as Bundle[]
  assertEquals(comp(said[0], 'session'), { id: 'abc', actor: 'p1' })
  assert(said[0].entity.eid.startsWith('$'))
  assertEquals(comp(said[1], 'content').body, '# abc')
})

Deno.test('a session that exists is handed back what it was in the middle of', async () => {
  let rows = [
    row(
      { entity: { eid: 's1', num: 3 }, session: { id: 'abc', actor: 'p1' } },
      'session.id',
    ),
    row(
      { entity: { eid: 't1', num: 7 }, doc: { title: 'ship it' } },
      'claim.session',
    ),
    row(
      { entity: { eid: 's0' }, brief: { text: 'landed the thing' } },
      'brief!',
    ),
  ]
  let said = await runs.session_context!(
    [],
    ctx({ session: 'abc' }, rows),
  ) as Bundle[]
  assertEquals(said[0].entity.eid, 's1')
  assertEquals(
    comp(said[1], 'content').body,
    [
      '# S-3',
      '',
      '## claimed',
      '- D-7 — ship it',
      '',
      '## previously',
      'landed the thing',
    ].join('\n'),
  )
})

Deno.test('a wrap records the account and lets go of everything', async () => {
  let rows = [
    row({ entity: { eid: 's1' }, session: { id: 'abc' } }, 'session.id'),
    row({ entity: { eid: 't1' } }, 'claim.session'),
    row({ entity: { eid: 't2' } }, 'claim.session'),
  ]
  let said = await runs.session_wrap!(
    [],
    ctx({ hook: '{"session_id":"abc"}', brief: 'did the thing' }, rows),
  ) as Bundle[]
  assertEquals(comp(said[0], 'brief'), { text: 'did the thing' })
  assertEquals(said.slice(1).map((b) => [b.entity.eid, b.claim]), [
    ['t1', null],
    ['t2', null],
  ])
})

Deno.test('a session nobody reified wraps to nothing', async () => {
  assertEquals(await runs.session_wrap!([], ctx({ session: 'gone' })), [])
})
