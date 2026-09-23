import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph, ToolCtx } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { sessionDoc } from './comp.ts'
import { ids, locked, pages, seed, store } from './harness.ts'
import { hookSession, type Options, runs } from './tools.ts'

let vocab = loadVocab([docDoc, taskDoc, sessionDoc], [idKeywords])

// The runs, built the way a host builds them: a facet is a factory now, and
// these tools take nothing from the host but its words.
let tools = runs({ vocab })

// The store, as far as these tools read it: a list of bundles and the queries
// they answer. Each tool asks one thing, so the stub answers by prefix — and
// a get by eid, which is the first rung of reaching a session by the word a
// caller said (./who.ts).
//
// `actor` is the run a door signed the call with: `via` the transcript, `by`
// whoever it speaks for.
let ctx = (
  args: Record<string, unknown>,
  rows: Bundle[] = [],
  actor?: string,
) =>
  ({
    args,
    actor: actor ? { by: 'p1', via: actor } : null,
    graph: {
      vocab,
      address: () => new Map(),
      storage: {
        tx: (run: (tx: { get: (eids: string[]) => Bundle[] }) => unknown) =>
          run({
            get: (eids: string[]) =>
              rows.filter((b) => eids.includes(b.entity.eid)),
          }),
      },
    },
    read: (q: string) =>
      rows.filter((b) =>
        Object.entries(b.$match ?? {}).every(([k]) => String(q).includes(k))
      ),
  }) as unknown as ToolCtx

// A row the stub answers for any query naming `on`.
let row = (b: Bundle, on: string): Bundle => ({ ...b, $match: { [on]: true } })

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('every session tool is declared and implemented', () => {
  assertEquals(loadTools(sessionDoc, tools).map((t) => t.name).sort(), [
    'claim_check',
    'claim_release',
    'claim_take',
    'hooks_install',
    'session_brief',
    'session_check',
    'session_context',
    'session_listen',
    'session_wrap',
  ])
})

Deno.test('a claim is taken for whoever is asking', async () => {
  let [said] = await tools.claim_take!(
    [],
    ctx({ target: 't' }, [], 's'),
  ) as Bundle[]
  assertEquals(said.entity.eid, 't')
  assertEquals(comp(said, 'claim'), { session: 's' })
})

Deno.test('one word means one run: the lock and the wrap take the same --session', async () => {
  // The transcript, reachable by the eid it has and by the name its runner
  // gave it — and the claim row the lock leaves behind.
  let rows = [
    row({ entity: { eid: 's1' }, session: { id: 'abc' } }, 'session.id'),
    row({ entity: { eid: 's1' }, session: { id: 'abc' } }, 'eid'),
    row({ entity: { eid: 't1' } }, 'claim.session'),
  ]
  let [took] = await tools.claim_take!(
    [],
    ctx({ target: 't1', session: 'abc' }, rows),
  ) as Bundle[]
  // The lock names the session, never the word the caller typed.
  assertEquals(comp(took, 'claim'), { session: 's1' })

  let [, freed] = await tools.session_wrap!(
    [],
    ctx({ session: 'abc', brief: 'done' }, rows),
  ) as Bundle[]
  assertEquals([freed.entity.eid, freed.claim], ['t1', null])
})

Deno.test('a lock for a run nothing answers to is a refusal, not a lock', async () => {
  let threw = ''
  try {
    await tools.claim_take!([], ctx({ target: 't', session: 'S-404' }))
  } catch (e) {
    threw = (e as Error).message
  }
  assertEquals(threw, 'no session answers to S-404')
})

Deno.test('nobody asking and nobody named is a refusal, not a lock', async () => {
  let threw = false
  try {
    await tools.claim_take!([], ctx({ target: 't' }))
  } catch {
    threw = true
  }
  assert(threw)
})

Deno.test('a release drops the component', async () => {
  let [said] = await tools.claim_release!([], ctx({ target: 't' })) as Bundle[]
  assertEquals(said.claim, null)
})

Deno.test('a hook payload names the session; anything else says nothing', () => {
  assertEquals(hookSession('{"session_id":"abc"}'), 'abc')
  assertEquals(hookSession('not json at all'), '')
  assertEquals(hookSession(undefined), '')
})

Deno.test('a session nobody has seen is minted, with its own heading', async () => {
  let said = await tools.session_context!(
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
    // Under lease, and still a task: `claim` is a kind too, and a task says
    // it sorts before one (@yaks/task's vocabulary), so the line reads T-7.
    row(
      {
        entity: { eid: 't1', num: 7 },
        task: {},
        doc: { title: 'ship it' },
        claim: { session: 's1' },
      },
      'claim.session',
    ),
  ]
  let said = await tools.session_context!(
    [],
    ctx({ session: 'abc' }, rows),
  ) as Bundle[]
  assertEquals(said[0].entity.eid, 's1')
  assertEquals(
    comp(said[1], 'content').body,
    ['# S-3', '', '## claimed', '- T-7 — ship it'].join('\n'),
  )
})

Deno.test('a wrap records the account and lets go of everything', async () => {
  let rows = [
    row({ entity: { eid: 's1' }, session: { id: 'abc' } }, 'session.id'),
    row({ entity: { eid: 't1' } }, 'claim.session'),
    row({ entity: { eid: 't2' } }, 'claim.session'),
  ]
  let said = await tools.session_wrap!(
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
  assertEquals(await tools.session_wrap!([], ctx({ session: 'gone' })), [])
})

Deno.test('a brief lands on the transcript wearing that name', async () => {
  let rows = [
    row({ entity: { eid: 's1' }, session: { id: 'abc' } }, 'session.id'),
  ]
  let [said] = await tools.session_brief!(
    [],
    ctx({ session: 'abc', text: 'did the thing' }, rows),
  ) as Bundle[]
  assertEquals(said.entity.eid, 's1')
  assertEquals(comp(said, 'brief'), { text: 'did the thing' })
})

Deno.test('a brief for a transcript nobody reified reifies it, never the word', async () => {
  let [said] = await tools.session_brief!(
    [],
    ctx({ session: 'S-37703', text: 'did the thing' }),
  ) as Bundle[]
  // Not `S-37703` — a human id is not an eid, and writing it as one would mint
  // an entity called that.
  assertEquals(said.entity.eid, '$session')
  assertEquals(comp(said, 'session'), { id: 'S-37703' })
  assertEquals(comp(said, 'brief'), { text: 'did the thing' })
})

// ---- the checks ------------------------------------------------------------
//
// These read a whole graph rather than the stub above — a lock's holder, and
// the entries that say what a transcript is doing — so they run over the same
// in-memory store the rest of this package's tests use.

// One check run, as a host would call it.
let checkup = async (
  name: 'claim_check' | 'session_check',
  g: Graph,
  options: Options = {},
) => {
  let [said] = await runs({ vocab: pages }, options)[name]([], {
    graph: g,
    actor: null,
    read: (q) => g.read(q),
    args: {},
    call: 'c1',
  } as ToolCtx) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.error as Comp | undefined)?.code,
  }
}

let ago = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString()

// A page locked by `run1`, plus whatever entries the case gives that run.
let rigged = (...entries: Bundle[]) => {
  let s = store()
  seed(
    s,
    { entity: { eid: ids.p1 }, claim: { session: ids.run1 } },
    ...entries,
  )
  return locked(s)
}

let line = (seq: number, at: string, comps: Bundle) => ({
  ...comps,
  entry: { session: ids.run1, seq },
  created: { at },
})

Deno.test('a lock held by a live transcript is nothing to report', async () => {
  let g = rigged(
    line(1, ago(0.1), { entity: { eid: 'l1' }, content: { body: 'go' } }),
  )
  assertEquals((await checkup('claim_check', g)).level, undefined)
})

Deno.test('a lock held by a stopped transcript is a warn', async () => {
  let g = rigged(
    line(1, ago(1), { entity: { eid: 'l1' }, content: { body: 'go' } }),
    line(2, ago(1), { entity: { eid: 'l2' }, stop: {} }),
  )
  let said = await checkup('claim_check', g)
  assertEquals(said.level, 'warn')
  assert(said.body.includes('whose transcript stopped'), said.body)
})

Deno.test('a lock naming no session at all is a warn', async () => {
  let s = store()
  seed(s, { entity: { eid: ids.p1 }, claim: { session: ids.gone } })
  let said = await checkup('claim_check', locked(s))
  assertEquals(said.level, 'warn')
  assert(said.body.includes('has no session for'), said.body)
})

Deno.test('a transcript owed an answer for hours is a warn', async () => {
  let g = rigged(
    line(1, ago(9), { entity: { eid: 'l1' }, content: { body: 'go' } }),
  )
  let said = await checkup('session_check', g)
  assertEquals(said.level, 'warn')
  assert(said.body.includes('has been pending since'), said.body)
})

Deno.test('a transcript owed an answer since a moment ago is working', async () => {
  let g = rigged(
    line(1, ago(0.1), { entity: { eid: 'l1' }, content: { body: 'go' } }),
  )
  assertEquals((await checkup('session_check', g)).level, undefined)
})

Deno.test('a settled transcript is never stalled, however old', async () => {
  let g = rigged(
    line(1, ago(99), { entity: { eid: 'l1' }, content: { body: 'go' } }),
    line(2, ago(99), {
      entity: { eid: 'l2' },
      content: { body: 'done' },
      output: { source: 'l1' },
    }),
  )
  assertEquals((await checkup('session_check', g)).level, undefined)
})
