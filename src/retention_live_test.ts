import { assertEquals } from '@std/assert'
import {
  applyLocal,
  cache,
  census,
  dropQuery,
  ent,
  holdQuery,
  landSub,
  restore,
  seedFrom,
  subscribe,
  subscriptionState,
  unsubscribe,
  useRoute,
} from './live.ts'
import { parseQuery } from './query.ts'

let changes = (eid: string) => [
  { eid, name: 'entity', comp: { eid, num: 1 } },
  { eid, name: 'doc', comp: { title: eid } },
  { eid, name: 'comment', comp: { target: 'card' } },
]

Deno.test('reopen paints retained rows before sending; confirmation removes stale hits', () => {
  cache.value = {}
  restore({}, {})
  let route = useRoute(() => {})
  let preds = parseQuery('.comment.target=card')
  let sub = `q:${JSON.stringify(preds)}`
  try {
    landSub({ sub, replace: true, changes: [...changes('a'), ...changes('b')] })
    let before = census.peek()
    unsubscribe(sub)
    assertEquals(census.peek() === before, true)
    assertEquals(cache.peek().a, undefined)
    assertEquals(ent('a').doc?.title, 'a')
    let sent = false
    useRoute(() => {
      sent = true
      assertEquals(ent('a').doc?.title, 'a')
      assertEquals(subscriptionState(sub), { status: 'loading' })
    })
    let ids = holdQuery(preds)
    assertEquals(sent, true)
    assertEquals(ids.peek().sort(), ['a', 'b'])
    // Test transport is shadow; a real non-shadow subscription is what owns
    // eviction. subscribe uses the same prime, without the legacy shadow flag.
    subscribe('confirm', '.comment.target=card')
    landSub({ sub: 'confirm', replace: true, changes: changes('b') })
    assertEquals(ent('a').doc, undefined)
    assertEquals(ent('b').doc?.title, 'b')
    assertEquals(ids.peek(), ['b'])
    useRoute(() => {})
    landSub({ sub, replace: true, changes: changes('b') })
    assertEquals(subscriptionState(sub).status, 'ready')
    dropQuery(preds)
    unsubscribe('confirm')
  } finally {
    useRoute(route)
    cache.value = {}
    restore({}, {})
  }
})

Deno.test('retained tombstones never resurrect through reads', () => {
  let route = useRoute(() => {})
  try {
    cache.value = {}
    landSub({ sub: 'dead', replace: true, changes: changes('dead') })
    unsubscribe('dead')
    assertEquals(ent('dead').doc?.title, 'dead')
    applyLocal([{ eid: 'dead', name: 'entity', comp: null }])
    assertEquals(ent('dead').doc, undefined)
  } finally {
    useRoute(route)
  }
})

Deno.test('ownership-only retention does not expand a confirmed bounded query', () => {
  let route = useRoute(() => {})
  let preds = parseQuery('.comment.target=card')
  let sub = `q:${JSON.stringify(preds)}`
  try {
    cache.value = {}
    landSub({ sub: 'other-holder', replace: true, changes: changes('a') })
    let ids = holdQuery(preds)
    landSub({ sub, replace: true, window: { limit: 1 }, changes: changes('b') })
    assertEquals(ids.peek(), ['b'])
    unsubscribe('other-holder')
    assertEquals(ent('a').doc?.title, 'a')
    assertEquals(ids.peek(), ['b'])
    let before = census.peek()
    applyLocal(changes('a'))
    assertEquals(census.peek() === before, true)
    assertEquals(ids.peek(), ['b'])
    dropQuery(preds)
  } finally {
    useRoute(route)
    cache.value = {}
    restore({}, {})
  }
})

Deno.test('bounded confirmation does not invalidate retained rows outside its page', () => {
  let route = useRoute(() => {})
  try {
    cache.value = {}
    landSub({
      sub: 'card-comments',
      replace: true,
      changes: changes('comment'),
    })
    unsubscribe('card-comments')
    subscribe('board:hot', '.order=hot')
    landSub({
      sub: 'board:hot',
      replace: true,
      window: { limit: 400 },
      changes: changes('other'),
    })
    assertEquals(cache.peek().comment, undefined)
    assertEquals(ent('comment').doc?.title, 'comment')
    unsubscribe('board:hot')
  } finally {
    useRoute(route)
    cache.value = {}
    restore({}, {})
  }
})

Deno.test('full confirmation drops removed components without blanking retained rows', () => {
  let route = useRoute(() => {})
  try {
    cache.value = {}
    landSub({ sub: 'route:full', replace: true, changes: changes('full') })
    applyLocal([{ eid: 'full', name: 'doc', comp: { body: 'removed' } }])
    unsubscribe('route:full')
    subscribe('route:full', 'id=full')
    assertEquals(ent('full').comment?.target, 'card')
    landSub({
      sub: 'route:full',
      replace: true,
      changes: changes('full').filter((c) => c.name != 'comment'),
    })
    assertEquals(ent('full').doc?.title, 'full')
    assertEquals(ent('full').doc?.body, undefined)
    assertEquals(ent('full').comment, undefined)
    unsubscribe('route:full')
  } finally {
    useRoute(route)
    cache.value = {}
    restore({}, {})
  }
})

Deno.test('disk rows stay provisional across same epoch and vanish on epoch bump', async () => {
  cache.value = {}
  restore({
    old: { entity: { eid: 'old', num: 1 }, doc: { eid: 'old', title: 'old' } },
  }, {
    epoch: 'A',
    cursor: 999,
  })
  assertEquals(cache.peek().old, undefined)
  assertEquals(ent('old').doc?.title, 'old')
  assertEquals(subscriptionState('boot'), { status: 'loading' })
  await seedFrom({ changes: [], deps: [], epoch: 'A', cursor: 1000 }, false)
  assertEquals(ent('old').doc?.title, 'old')
  await seedFrom({ changes: [], deps: [], epoch: 'B', cursor: 1 }, false)
  assertEquals(ent('old').doc, undefined)
  restore({ unscoped: { doc: { eid: 'unscoped', title: 'untrusted' } } }, {})
  assertEquals(ent('unscoped').doc, undefined)
})

Deno.test('bodyless confirmations preserve retained bodies', () => {
  let route = useRoute(() => {})
  try {
    cache.value = {}
    landSub({ sub: 'bodyless', replace: true, changes: changes('bodyless') })
    applyLocal([{
      eid: 'bodyless',
      name: 'doc',
      comp: { body: 'cached body' },
    }])
    unsubscribe('bodyless')
    subscribe('bodyless', 'id=bodyless')
    landSub({ sub: 'bodyless', replace: true, changes: changes('bodyless') })
    assertEquals(ent('bodyless').doc?.body, 'cached body')
    unsubscribe('bodyless')
  } finally {
    useRoute(route)
    cache.value = {}
    restore({}, {})
  }
})

Deno.test('same-epoch reconnect retains live rows and re-primes mounted subscriptions', async () => {
  let route = useRoute(() => {})
  try {
    cache.value = {}
    restore({}, { epoch: 'reconnect' })
    subscribe('route:reconnect', 'id=reconnect')
    landSub({
      sub: 'route:reconnect',
      replace: true,
      changes: changes('reconnect'),
    })
    await seedFrom(
      { changes: [], deps: [], epoch: 'reconnect', cursor: 1 },
      false,
    )
    assertEquals(cache.peek().reconnect, undefined)
    assertEquals(ent('reconnect').doc?.title, 'reconnect')
    assertEquals(subscriptionState('route:reconnect').status, 'loading')
    landSub({ sub: 'route:reconnect', replace: true, changes: [] })
    assertEquals(ent('reconnect').doc, undefined)
    unsubscribe('route:reconnect')
  } finally {
    useRoute(route)
    cache.value = {}
    restore({}, {})
  }
})
