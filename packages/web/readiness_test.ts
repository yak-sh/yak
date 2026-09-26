// Cold, provisional and confirmed-empty are distinct read states.
import './testing.ts'
import { assertEquals } from '@std/assert'
import { effect } from '@preact/signals'
import { FakeTime } from '@std/testing/time'
import { host } from './host_testing.ts'
import {
  aggValue,
  cache,
  clientSubscription,
  dropAgg,
  ent,
  entityRead,
  entrySub,
  foldFor,
  holdAgg,
  landSub,
  loaded,
  repoTrace,
  routeName,
  routeSub,
  subscriptionState,
  unsubscribe,
  useRoute,
} from './live.ts'

Deno.test('fold absence becomes expanded only after the client first frame', () => {
  let prior = useRoute(() => {})
  let client = 'cold-fold-client'
  try {
    let read = clientSubscription(client)!
    assertEquals(read.state.status, 'loading')
    assertEquals(foldFor(client, 'board'), undefined)
    landSub({ sub: read.sub, replace: true, changes: [] })
    assertEquals(clientSubscription(client)?.state.status, 'ready')
    assertEquals(foldFor(client, 'board'), undefined)
    landSub({
      sub: read.sub,
      changes: [
        {
          eid: 'fold',
          name: 'fold',
          comp: { client, board: 'board', statuses: 'done' },
        },
      ],
    })
    assertEquals(foldFor(client, 'board')?.statuses, 'done')
  } finally {
    useRoute(prior)
  }
})

Deno.test('repo trace names missing hops and stops cycles', () => {
  cache.value = {
    task: { filed: { eid: 'task', project: 'project' } },
    comment: { comment: { eid: 'comment', target: 'task' } },
  }
  assertEquals(repoTrace(ent('comment')), {
    eids: ['comment', 'task', 'project'],
  })
  cache.value = {
    ...cache.peek(),
    project: {
      repo: {
        eid: 'project',
        path: '',
        base_branch: 'main',
        url: 'https://github.com/acme/repo',
      },
    },
  }
  assertEquals(repoTrace(ent('comment')).url, 'https://github.com/acme/repo')
  cache.value = { cycle: { comment: { eid: 'cycle', target: 'cycle' } } }
  assertEquals(repoTrace(ent('cycle')), { eids: ['cycle'] })
})

Deno.test('entity read distinguishes loading, loaded, and confirmed absent', () => {
  let prior = useRoute(() => {})
  let eid = 'cold-read'
  let fields = 'doc.title'
  let sub = routeName(eid, fields)
  cache.value = {}
  assertEquals(entityRead(eid, fields).ready, false)
  assertEquals(loaded(eid, 'doc', 'title'), false)
  let wakes: boolean[] = []
  let off = effect(() => {
    wakes.push(loaded(eid, 'doc', 'title'))
  })
  try {
    landSub({
      sub,
      replace: true,
      changes: [
        { eid, name: 'entity', comp: { num: 1 } },
        { eid, name: 'doc', comp: { title: 'Loaded' } },
      ],
    })
    let read = entityRead(eid, fields)
    assertEquals(read.ready, true)
    assertEquals(read.value?.doc?.title, 'Loaded')
    assertEquals(wakes.at(-1), true)
    landSub({ sub, replace: true, changes: [] })
    assertEquals(entityRead(eid, fields).ready, true)
    assertEquals(entityRead(eid, fields).value, undefined)
  } finally {
    off()
    unsubscribe(sub)
    useRoute(prior)
  }
})

Deno.test('entity holds share one line and close at the last release', () => {
  let sent: { subscribe?: string; unsubscribe?: string }[] = []
  let prior = useRoute((frame) => void sent.push(frame as typeof sent[number]))
  try {
    let a = routeSub('reference', 'doc.title')
    let b = routeSub('reference', 'doc.title')
    assertEquals(sent.flatMap((f) => f.subscribe ?? []), ['.eid=reference&*'])
    a()
    assertEquals(sent.some((f) => f.unsubscribe), false)
    b()
    assertEquals(sent.filter((f) => f.unsubscribe).length, 1)
  } finally {
    useRoute(prior)
  }
})

// T-37450: a lost socket never costs a painted read. Each line goes unready on
// the wire until its resubscribe is answered; meanwhile every read keeps the
// answer it had, and the next answer replaces it. Only a refusal takes one back.
Deno.test('a read keeps its answer through a lost socket until the next one', async () => {
  let S = '5e550000-0000-4000-8000-000000000001'
  let E = '5e550000-0000-4000-8000-000000000002'
  let TALLY = '.task&.tally=task.status'
  let open = 2
  cache.value = {}
  using time = new FakeTime()
  let wire = host((a) =>
    a.subscribe.startsWith('.entry')
      ? { bundles: [{ entity: { eid: E, num: 1 }, entry: { session: S } }] }
      : a.subscribe.startsWith(TALLY)
      ? { tally: { open } }
      : undefined
  )
  let off = entrySub(S)
  holdAgg('tally:lost', TALLY)
  let reads = () => ({
    entries: subscriptionState(`entries:${S}`),
    open: aggValue('tally:lost', TALLY, 'open'),
  })
  let answered: ReturnType<typeof reads> = {
    entries: { status: 'ready', eids: new Set([E]) },
    open: 2,
  }
  try {
    await time.tickAsync(0)
    assertEquals(reads(), answered)
    wire.drop()
    assertEquals(reads(), answered)
    open = 3
    await time.tickAsync(1_000)
    await time.tickAsync(0)
    assertEquals(reads(), { ...answered, open: 3 })
    let ask = wire.asked().findLast((a) => a.subscribe.startsWith(TALLY))!
    void wire.say({ id: ask.id, refused: { error: 'Refused', message: 'no' } })
    await time.tickAsync(0)
    assertEquals(reads().open, undefined)
  } finally {
    off()
    dropAgg('tally:lost')
    wire.free()
  }
})
