/** Page-model contracts, with no server, polling clock or guessed sleeps. */
import { effect } from '@preact/signals'
import { equal, ok, test } from '@yaks/testing'
import { type Activity, atlas, causes, type ModelOptions } from './model.ts'
import { GROUPS, type Snapshot } from './snapshot.ts'
import type { Source } from './stream.ts'

let composition = (host = 'fixture-process'): Snapshot => ({
  version: 1,
  takenAt: '2026-10-01T00:00:00.000Z',
  coverage: {
    scope: host,
    activity: 'process-local',
    recording: 'subscriber-only',
    clock: 'monotonic',
    capacity: 256,
    observed: Object.fromEntries(
      GROUPS.map((group) => [group, ['rules', 'views'].includes(group)]),
    ),
  },
  anatomy: {
    version: 1,
    host,
    packages: [],
    roles: [],
    facets: [],
    comps: [],
    tools: [],
    commands: [],
    effects: [],
    hooks: [],
    routes: [],
    inspectViews: [],
    tui: [],
    kits: [],
    themes: [],
    skills: [],
    secrets: [],
    rules: [{
      id: 'part:rule',
      name: 'owned.rule',
      package: '@yaks/fixture',
      declared: true,
      loaded: true,
      bound: true,
      hooks: ['rules'],
    }],
    views: [{
      id: 'part:view',
      name: 'FixtureView',
      package: '@yaks/fixture',
      declared: true,
      loaded: true,
      bound: false,
      description: 'An imported contract, not a mounted renderer.',
    }],
    edges: [{
      id: 'relation:rule-view',
      from: 'part:rule',
      to: 'part:view',
      kind: 'owns-contract',
    }],
  },
})

let observation = (seq: number, patch: Partial<Activity> = {}): Activity => ({
  epoch: 'epoch-a',
  seq,
  id: `span-${seq}`,
  kind: 'apply',
  name: 'apply',
  stage: 'instant',
  time: 0,
  ...patch,
})

let source = () => {
  let target = new EventTarget()
  let closes = 0
  // The native EventTarget implements the listener machinery; only the three
  // resource fields EventSource contributes are faked. Frames still use real
  // MessageEvents, including callbacks deliberately fired after close.
  let handle = Object.assign(target, {
    readyState: 1,
    onopen: null as Source['onopen'],
    onerror: null as Source['onerror'],
    close: () => {
      closes++
    },
  }) as unknown as Source
  return {
    handle,
    get closes() {
      return closes
    },
    raw: (kind: string, data: string) =>
      target.dispatchEvent(
        new MessageEvent(kind, { data }),
      ),
    frame: (kind: string, data: unknown) =>
      target.dispatchEvent(
        new MessageEvent(kind, { data: JSON.stringify(data) }),
      ),
    hello: (epoch = 'epoch-a', omitted = 0) =>
      target.dispatchEvent(
        new MessageEvent('hello', { data: JSON.stringify({ epoch, omitted }) }),
      ),
    status: (kind: 'open' | 'error') => {
      let callback = kind == 'open' ? handle.onopen : handle.onerror // stream installs arrow callbacks which do not use an EventSource this.
      ;(callback as ((event: Event) => void) | null)?.(new Event(kind))
    },
  }
}

let fixture = (opts: Pick<ModelOptions, 'fetch' | 'start'> = {}) => {
  let value = composition()
  let feeds: { url: string; source: ReturnType<typeof source> }[] = []
  let requests: { url: string; options?: RequestInit }[] = []
  let model = atlas({
    base: 'http://mri.test',
    start: opts.start,
    fetch: (url, options) => {
      requests.push({ url: String(url), options })
      return opts.fetch?.(url, options) ?? Promise.resolve(Response.json(value))
    },
    connect: (url) => {
      let made = source()
      feeds.push({ url, source: made })
      return made.handle
    },
  })
  return {
    model,
    feeds,
    requests,
    get source() {
      return ok(feeds.at(-1)).source
    },
    anatomy: (next: Snapshot) => {
      value = next
    },
  }
}

let deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  let promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('MRI drafts and graph-owned appearance are reactive and page-private', () => {
  let a = fixture({ start: false })
  let b = fixture({ start: false })
  let heard: string[] = []
  let off = effect(() => {
    let s = a.model.state
    heard.push(`${s.filter}|${s.theme}|${s.scheme}|${s.view}`)
  })
  try {
    equal(a.model.state.filter, '')
    a.model.search('rules')
    equal(a.model.state.filter, 'rules')
    a.model.set({ theme: 'rosepine', scheme: 'light', view: 'list' })
    equal(heard.at(-1), 'rules|rosepine|light|list')
    a.model.set({ filter: 'prepare', group: 'phases', listPage: 2 })
    equal(a.model.state.filter, 'prepare')
    equal(a.model.state.group, 'phases')
    equal(a.model.state.listPage, 2)
    equal(b.model.state.filter, '')
    equal(b.model.state.theme, 'everforest')
    equal(a.feeds.length, 0)
    equal(a.requests.length, 0)
  } finally {
    off()
    a.model.close()
    b.model.close()
  }
})

test('MRI camera normalization and reset do not reset domain navigation', () => {
  let { model } = fixture({ start: false })
  try {
    model.search('stamp')
    model.select('phase:stamp')
    model.set({ x: 80, y: -15, zoom: 2, group: 'phases', listPage: 3 })
    model.set({ x: Infinity, y: NaN, zoom: 99, listPage: 4.9 })
    equal([model.state.x, model.state.y, model.state.zoom], [80, -15, 3])
    equal(model.state.listPage, 4)
    model.set({ zoom: -1, listPage: -2 })
    equal([model.state.zoom, model.state.listPage], [.35, 0])
    model.reset()
    equal([model.state.x, model.state.y, model.state.zoom], [0, 0, 1])
    equal(model.state.selected, 'phase:stamp')
    equal(model.state.filter, 'stamp')
    equal(model.state.group, 'phases')
  } finally {
    model.close()
  }
})

test('MRI explanatory phases include prepare and do not imply bound handlers', () => {
  let { model } = fixture({ start: false })
  try {
    let phases = model.nodes.filter((n) => n.group == 'phases')
    equal(phases.map((n) => n.name), [
      'normalize',
      'admit',
      'mint',
      'prepare',
      'precondition',
      'rules',
      'mutate',
      'cascade',
      'stamp',
      'journal',
      'commit',
      'effect',
      'audit',
    ])
    equal(phases.map((n) => n.detail.order), phases.map((_, i) => i))
    ok(phases.every((n) => !n.loaded && !n.bound))
    equal(phases.at(-1)?.detail.path, 'rollback')
    model.select('phase:prepare')
    equal(model.selected?.name, 'prepare')
  } finally {
    model.close()
  }
})

test('MRI private UUID references round-trip part and relation public IDs', async () => {
  let f = fixture({ start: false })
  try {
    await f.model.refresh()
    equal(f.model.state.host, 'fixture-process')
    equal(f.model.coverage.views, true)
    equal(f.model.coverage.skills, false)
    equal(f.model.edges, composition().anatomy.edges)
    f.model.select('part:rule')
    equal(f.model.selected?.name, 'owned.rule')
    equal(f.model.state.selected, 'part:rule')
    f.model.select('relation:rule-view')
    equal(f.model.state.selected, 'relation:rule-view')
    equal(f.model.selected, undefined)
    f.model.select('not-a-part')
    equal(f.model.state.selected, '')
    equal(f.requests[0].url, 'http://mri.test/visualize/anatomy')
    equal(f.requests[0].options?.redirect, 'error')
    equal(f.requests[0].options?.credentials, 'same-origin')
  } finally {
    f.model.close()
  }
})

test('MRI metadata refresh prunes removed parts, relations and selection', async () => {
  let f = fixture({ start: false })
  try {
    await f.model.refresh()
    f.model.select('part:rule')
    let next = composition('changed-process')
    next.anatomy.rules = []
    next.anatomy.edges = []
    f.anatomy(next)
    await f.model.refresh()
    equal(f.model.state.selected, '')
    equal(f.model.selected, undefined)
    equal(f.model.edges, [])
    ok(!f.model.nodes.some((n) => n.id == 'part:rule'))
    equal(f.model.state.host, 'changed-process')
    equal(f.feeds.length, 0)
  } finally {
    f.model.close()
  }
})

test('MRI causes use span IDs, collapse start/end and keep retained relatives', async () => {
  let f = fixture()
  try {
    await f.model.refresh()
    f.source.hello()
    f.source.frame('activity', observation(1, { id: 'write', stage: 'start' }))
    f.source.frame(
      'activity',
      observation(2, {
        id: 'rule',
        kind: 'rule',
        name: 'owned.rule',
        package: '@yaks/fixture',
        parent: 'write',
        stage: 'end',
        duration: 0,
      }),
    )
    f.source.frame(
      'activity',
      observation(3, {
        id: 'read',
        kind: 'query',
        parent: 'rule',
        stage: 'end',
        duration: 0,
      }),
    )
    f.source.frame(
      'activity',
      observation(4, {
        id: 'write',
        stage: 'end',
        duration: 0,
      }),
    )
    f.model.choose('rule')
    equal(f.model.state.cause, 'rule')
    equal(
      new Set(f.model.cause.map((e) => e.id)),
      new Set(['write', 'rule', 'read']),
    )
    equal(f.model.cause.filter((e) => e.id == 'write').length, 1)
    equal(f.model.cause.find((e) => e.id == 'write')?.stage, 'end')
    equal(f.model.events.length, 4)
    equal(f.model.events.find((e) => e.id == 'rule')?.node, 'part:rule')
    f.model.choose('unknown-span')
    equal(f.model.state.cause, '')
    equal(f.model.cause, [])
  } finally {
    f.model.close()
  }
})

test('MRI phase activity maps to the explanatory spine without a new clock', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame(
      'activity',
      observation(1, {
        kind: 'phase',
        name: 'graph.prepare',
        stage: 'end',
        duration: 0,
      }),
    )
    equal(f.model.events[0].node, 'phase:prepare')
    equal(f.model.events[0].time, 0)
    equal(f.model.events[0].duration, 0)
    equal(f.model.state.received, 1)
  } finally {
    f.model.close()
  }
})

test('MRI ignores duplicate and out-of-order observations in one epoch', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', observation(1))
    f.source.frame('activity', observation(2))
    f.source.frame('activity', observation(2, { id: 'duplicate' }))
    f.source.frame('activity', observation(1, { id: 'late' }))
    equal(f.model.events.map((e) => e.id), ['span-1', 'span-2'])
    equal(f.model.state.received, 2)
    equal(f.model.state.gap, 0)
  } finally {
    f.model.close()
  }
})

test('MRI retains 256 zero-time records and clears an evicted chosen span', () => {
  let f = fixture()
  try {
    f.source.hello()
    for (let seq = 1; seq <= 256; seq++) {
      f.source.frame('activity', observation(seq))
    }
    f.model.choose('span-1')
    equal(f.model.state.cause, 'span-1')
    f.source.frame('activity', observation(257))
    equal(f.model.events.length, 256)
    equal(f.model.events[0].seq, 2)
    equal(f.model.events.at(-1)?.seq, 257)
    ok(f.model.events.every((e) => e.time === 0))
    equal(f.model.state.cause, '')
    equal(f.model.cause, [])
    equal(f.model.state.gap, 0)
    equal(f.model.state.received, 257)
  } finally {
    f.model.close()
  }
})

test('MRI a sequence jump cannot collide with an occupied event UUID slot', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', observation(1, { id: 'chosen' }))
    f.model.choose('chosen')
    f.source.frame('activity', observation(257))
    equal(f.model.events.map((e) => e.seq), [1, 257])
    equal(f.model.state.cause, 'chosen')
    equal(f.model.cause.map((e) => e.id), ['chosen'])
    equal(f.model.state.gap, 1)
  } finally {
    f.model.close()
  }
})

test('MRI epoch changes clear history, cause and old monotonic offsets', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', observation(1, { id: 'same', time: 600 }))
    f.model.choose('same')
    f.source.hello('epoch-b')
    equal(f.model.events, [])
    equal(f.model.state.cause, '')
    equal(f.model.state.gap, 1)
    f.source.frame(
      'activity',
      observation(1, {
        epoch: 'epoch-b',
        id: 'same',
        time: 0,
        duration: 0,
        stage: 'end',
      }),
    )
    equal(f.model.events.map((e) => [e.epoch, e.seq, e.time]), [[
      'epoch-b',
      1,
      0,
    ]])
    f.model.choose('same')
    equal(f.model.cause.length, 1)
    equal(f.model.cause[0].duration, 0)
    equal(f.model.state.gap, 1)
  } finally {
    f.model.close()
  }
})

test('MRI a disconnect changes status without claiming lost records', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.status('error')
    equal(f.model.state.connected, 'reconnecting')
    equal(f.model.state.gap, 0)
    f.source.status('open')
    f.source.hello()
    equal(f.model.state.connected, 'live')
    equal(f.model.state.gap, 0)
  } finally {
    f.model.close()
  }
})

test('MRI pause closes its lease; paused refresh cannot resume observation', async () => {
  let f = fixture()
  try {
    await f.model.refresh()
    let first = f.source
    first.hello()
    first.frame('activity', observation(1))
    f.model.set({ paused: true })
    equal(first.closes, 1)
    equal(f.model.state.connected, 'paused')
    first.frame('activity', observation(2))
    let next = composition('paused-metadata')
    f.anatomy(next)
    await f.model.refresh()
    equal(f.model.state.host, 'paused-metadata')
    equal(f.model.state.paused, true)
    equal(f.model.events.map((e) => e.seq), [1])
    equal(f.model.state.received, 1)
    equal(f.feeds.length, 1)
    f.model.set({ paused: false })
    equal(f.feeds.length, 2)
    equal(f.feeds[1].url, 'http://mri.test/visualize/events?tail=1')
    equal(f.model.state.gap, 1)
    f.source.hello('epoch-a', 98)
    f.source.frame('activity', observation(100))
    equal(f.model.events.map((e) => e.seq), [1, 100])
    equal(f.model.state.received, 2)
    equal(f.model.state.gap, 1)
    equal(first.closes, 1)
  } finally {
    f.model.close()
  }
})

test('MRI resume into a new epoch is one episode, not two or a record count', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', observation(1))
    f.model.choose('span-1')
    f.model.set({ paused: true })
    f.model.set({ paused: false })
    f.source.hello('epoch-b', 800)
    equal(f.model.state.gap, 1)
    equal(f.model.events, [])
    equal(f.model.state.cause, '')
    f.source.frame('activity', observation(801, { epoch: 'epoch-b' }))
    equal(f.model.events.map((e) => e.seq), [801])
    equal(f.model.state.gap, 1)
  } finally {
    f.model.close()
  }
})

test('MRI hello overflow plus its sequence jump is only one gap episode', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', observation(1))
    f.source.status('error')
    f.source.hello('epoch-a', 80)
    equal(f.model.state.gap, 1)
    f.source.frame('activity', observation(82))
    equal(f.model.state.gap, 1)
    f.source.frame('gap', { omitted: 10, reason: 'overflow' })
    f.source.frame('activity', observation(93))
    equal(f.model.state.gap, 2)
    f.source.frame('gap', { omitted: 0 })
    equal(f.model.state.gap, 2)
  } finally {
    f.model.close()
  }
})

test('MRI malformed frames expose only a safe error and no bogus activity', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.raw('activity', '{credential-shaped-invalid-json')
    equal(f.model.state.error, 'Invalid observation frame.')
    f.source.frame('activity', observation(-1))
    f.source.frame('activity', observation(1, { duration: -1 }))
    f.source.frame('hello', { epoch: 3, message: 'private-message' })
    equal(f.model.events, [])
    equal(f.model.state.received, 0)
    ok(!f.model.state.error.includes('credential'))
    ok(!f.model.state.error.includes('private-message'))
    f.source.frame('activity', observation(1))
    equal(f.model.events.length, 1)
  } finally {
    f.model.close()
  }
})

test('MRI invalid optional span metadata is not admitted into the contract', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', {
      ...observation(1),
      parent: { payload: 'not-a-span-id' },
      counts: { rows: 1 },
    })
    equal(f.model.events, [])
    equal(f.model.state.error, 'Invalid observation frame.')
  } finally {
    f.model.close()
  }
})

test('MRI retains only activity fields rather than arbitrary frame payloads', () => {
  let f = fixture()
  try {
    f.source.hello()
    f.source.frame('activity', {
      ...observation(1),
      payload: 'must-not-be-retained',
      entity: { eid: 'not-telemetry' },
      counts: { rows: 0, changes: 2 },
    })
    equal(f.model.events[0].counts, { rows: 0, changes: 2 })
    let text = JSON.stringify(f.model.events)
    ok(!text.includes('must-not-be-retained'))
    ok(!text.includes('not-telemetry'))
  } finally {
    f.model.close()
  }
})

test('MRI refresh rejection is handled internally and does not expose errors', async () => {
  let f = fixture({
    start: false,
    fetch: () => Promise.reject(new Error('private-authentication-payload')),
  })
  try {
    await f.model.refresh()
    equal(
      f.model.state.error,
      'Could not read host anatomy. Check access and retry.',
    )
    equal(f.model.state.host, '')
    ok(!f.model.state.error.includes('private-authentication-payload'))
    equal(f.feeds.length, 0)
  } finally {
    f.model.close()
  }
})

test('MRI replacing a refresh aborts and ignores its later response', async () => {
  let pending: ReturnType<typeof deferred<Response>>[] = []
  let f = fixture({
    start: false,
    fetch: () => {
      let response = deferred<Response>()
      pending.push(response)
      return response.promise
    },
  })
  try {
    let first = f.model.refresh()
    let second = f.model.refresh()
    equal(f.requests.length, 2)
    equal(f.requests[0].options?.signal?.aborted, true)
    equal(f.requests[1].options?.signal?.aborted, false)
    pending[1].resolve(Response.json(composition('newer')))
    await second
    equal(f.model.state.host, 'newer')
    pending[0].resolve(Response.json(composition('older')))
    await first
    equal(f.model.state.host, 'newer')
    equal(f.model.state.error, '')
  } finally {
    f.model.close()
    for (let response of pending) response.reject(new Error('closed fixture'))
  }
})

test('MRI close aborts fetch, closes once and rejects subsequent domain work', async () => {
  let response = deferred<Response>()
  let f = fixture({ start: false, fetch: () => response.promise })
  let loading = f.model.refresh()
  f.model.close()
  f.model.close()
  equal(f.requests[0].options?.signal?.aborted, true)
  response.resolve(Response.json(composition('too-late')))
  await loading
  let before = f.model.state
  f.model.search('after close')
  f.model.set({ theme: 'rosepine', paused: false, x: 50 })
  f.model.select('phase:stamp')
  f.model.choose('span-1')
  await f.model.refresh()
  equal(f.model.state, before)
  equal(f.model.state.host, '')
  equal(f.requests.length, 1)
  equal(f.feeds.length, 0)
})

test('MRI late EventSource callbacks cannot change a closed model', async () => {
  let f = fixture()
  await f.model.refresh()
  let old = f.source
  old.hello()
  old.frame('activity', observation(1))
  f.model.close()
  f.model.close()
  equal(old.closes, 1)
  let state = f.model.state
  let events = f.model.events
  old.hello('new-epoch', 99)
  old.frame('activity', observation(2))
  old.raw('activity', 'not-json')
  old.status('error')
  equal(f.model.state, state)
  equal(f.model.events, events)
})

test('MRI cause traversal terminates cycles and does not invent absent parents', () => {
  let events = [
    observation(1, { id: 'a', parent: 'b' }),
    observation(2, { id: 'b', parent: 'a' }),
    observation(3, { id: 'c', parent: 'missing' }),
    observation(4, { id: 'child', parent: 'a' }),
  ]
  equal(causes(events, 'a').map((e) => e.id), ['a', 'b', 'child'])
  equal(causes(events, 'c').map((e) => e.id), ['c'])
  equal(causes(events, 'missing'), [])
})

test('MRI cause helper cannot connect reused IDs across epoch boundaries', () => {
  let events = [
    observation(1, { id: 'parent', epoch: 'old' }),
    observation(2, { id: 'choice', parent: 'parent', epoch: 'old' }),
    observation(1, { id: 'choice', parent: 'parent', epoch: 'new' }),
  ]
  equal(causes(events, 'choice').map((e) => [e.epoch, e.id]), [[
    'new',
    'choice',
  ]])
})

test('MRI stale activity cannot reverse the authoritative hello epoch', () => {
  let f = fixture()
  try {
    f.source.hello('epoch-a')
    f.source.frame('activity', observation(1))
    f.source.hello('epoch-b')
    f.source.frame('activity', observation(1, { epoch: 'epoch-b' }))
    f.source.frame('activity', observation(2, { epoch: 'epoch-a' }))
    equal(f.model.events.map((e) => [e.epoch, e.seq]), [['epoch-b', 1]])
    equal(f.model.state.gap, 1)
  } finally {
    f.model.close()
  }
})
