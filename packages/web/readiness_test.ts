// Cold, provisional and confirmed-empty are distinct read states.
import './testing.ts'
import { assertEquals } from '@std/assert'
import { cache, clientSubscription, ent, foldFor, landSub, repoTrace, useRoute } from './live.ts'

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
