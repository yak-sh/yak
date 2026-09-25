// Cold, provisional and confirmed-empty are distinct read states.
import { assertEquals } from '@std/assert'
import { effect } from '@preact/signals'
import {
  cache,
  clientSubscription,
  ent,
  entityRead,
  foldFor,
  landSub,
  loaded,
  repoTrace,
  routeName,
  routeSub,
  unsubscribe,
  useRoute,
} from './live.ts'

Deno.test('entity read distinguishes loading, projected, and confirmed absent', () => {
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
      fields: [{ comp: 'doc', prop: 'title', wake: true }],
      changes: [
        { eid, name: 'entity', comp: { num: 1 } },
        { eid, name: 'doc', comp: { title: 'Loaded' } },
      ],
    })
    let read = entityRead(eid, fields)
    assertEquals(read.ready, true)
    assertEquals(read.value?.doc?.title, 'Loaded')
    assertEquals(read.loaded(eid, 'doc', 'body'), false)
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

Deno.test('projected entity holds share ownership and close at last release', () => {
  let frames: Record<string, unknown>[] = []
  let prior = useRoute((frame) => {
    frames.push(frame as Record<string, unknown>)
  })
  try {
    let a = routeSub('reference', 'doc.title')
    let b = routeSub('reference', 'doc.title')
    assertEquals(frames.length, 1)
    assertEquals(frames[0].q, 'id=reference&.fields=doc.title')
    a()
    assertEquals(frames.length, 1)
    b()
    assertEquals(frames.at(-1)?.unsub, routeName('reference', 'doc.title'))
  } finally {
    useRoute(prior)
  }
})
