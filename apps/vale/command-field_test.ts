import { signal } from '@preact/signals'
import { client, type Saved, stash as vaultStash } from '@yaks/client'
import { draftDoc, draftEid, drafts, type Stash } from '@yaks/draft'
import { mint } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import type { Result } from '@yaks/ux/completion'
import { loadVocab } from '@yaks/vocab'
import { uxDoc } from '@yaks/ux/vocab'
import { parseHTML } from 'linkedom'
import { commandField } from './command-field.ts'
import { comp } from './bundle.ts'

let tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

let storage = (): Stash => {
  let held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    key: (i) => [...held.keys()][i] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  }
}
let remote = () => ({
  client: client(loadVocab([draftDoc, uxDoc]), [drafts()], { vault: false }),
})
let empty = (_text: string, caret: number): Result => ({
  from: caret,
  to: caret,
  cands: [],
  whole: false,
})
let deferred = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((yes) => resolve = yes)
  return { promise, resolve }
}
let saved = (by: string, text: string): Saved => ({
  eid: draftEid(by, 'chat'),
  comps: { draft: { by, place: 'chat', text, rev: 1 } },
})
let bind = (host: ReturnType<typeof commandField>) => {
  let { document } = parseHTML('<input>')
  let input = document.querySelector('input')!
  input.setSelectionRange = (from, to) => {
    input.selectionStart = from
    input.selectionEnd = to
  }
  return { input, off: host.fields.bind('chat', input) }
}

test('acknowledged command drafts survive reload without the emergency stash', async () => {
  let net = remote(), by = mint(), stash = storage()
  let a = commandField(net, () => by, empty, { vault: false, stash, pace: 0 })
  let b = commandField(net, () => by, empty, {
    vault: false,
    stash: storage(),
    pace: 0,
  })
  try {
    await Promise.all([a.ready, b.ready])
    a.fields.type('chat', '/look around')
    await tick()
    equal(stash.length, 0)
    equal(b.fields.text('chat'), '/look around')
    equal(net.client.vocab.comp('Completion')?.sync, 'none')
    equal(draftDoc.$defs?.draft.sync, undefined)
    a.close()
    let c = commandField(net, () => by, empty, { vault: false })
    await c.ready
    equal(c.fields.text('chat'), '/look around')
    equal(await c.drafts.spend('chat'), true)
    equal(b.fields.text('chat'), '')
    c.close()
  } finally {
    a.close()
    b.close()
    net.client.close()
  }
})

test('binding before hydration cannot replace a saved draft with empty input', async () => {
  let net = remote(), by = mint(), loaded = deferred<Saved[]>()
  let vault = vaultStash([saved(by, '/restored')])
  let host = commandField(net, () => by, empty, {
    vault: { ...vault, load: () => loaded.promise },
    stash: storage(),
    pace: 0,
  })
  let { input, off } = bind(host)
  try {
    host.fields.set('chat', '')
    equal(net.client.read('.draft'), [])
    loaded.resolve(await vault.load())
    await host.ready
    equal(host.drafts.text('chat'), '/restored')
    equal(input.value, '/restored')
    await tick()
    equal(await vault.load(), [])
    equal(comp(net.client.ent(draftEid(by, 'chat')), 'draft').text, '/restored')
  } finally {
    off()
    host.close()
    net.client.close()
  }
})

test('switching accounts isolates held drafts and clears choices and signed-out input', async () => {
  let net = remote(), a = mint(), b = mint(), by = signal<string | null>(a)
  let host = commandField(net, () => by.value, (text) => ({
    from: 0,
    to: text.length,
    cands: [{ text: '/look', kind: 'command' }],
    whole: false,
  }), { vault: vaultStash([saved(b, 'B saved')]), stash: storage(), pace: 0 })
  let { input, off } = bind(host)
  try {
    await host.ready
    host.fields.type('chat', 'A held')
    ok(host.fields.row('chat')?.cands.length)
    by.value = b
    equal(input.value, 'B saved')
    equal(host.fields.row('chat')?.cands, [])
    host.fields.set('chat', 'B held')
    by.value = null
    equal(input.value, '')
    host.fields.type('chat', 'not signed in')
    by.value = a
    equal(input.value, 'A held')
    by.value = b
    equal(input.value, 'B held')
  } finally {
    off()
    host.close()
    net.client.close()
  }
})

test('emergency stashes are scoped to the app and account', async () => {
  let net = remote(),
    by = signal(mint()),
    a = by.value,
    b = mint(),
    stash = storage()
  stash.setItem(
    'draft:chat',
    JSON.stringify({ text: 'other app', over: '', rev: 0 }),
  )
  let gate = deferred<void>(), mutate = net.client.mutate
  net.client.mutate = (rows) =>
    rows.some((b) => b.draft)
      ? gate.promise.then(() => mutate(rows))
      : mutate(rows)
  let host = commandField(net, () => by.value, empty, {
    vault: false,
    stash,
    pace: 0,
  })
  try {
    await host.ready
    host.fields.type('chat', 'A unacknowledged')
    by.value = b
    host.fields.type('chat', 'B unacknowledged')
    equal(stash.length, 3)
    ok(stash.getItem(`vale:commands:vale:${a}:draft:chat`))
    ok(stash.getItem(`vale:commands:vale:${b}:draft:chat`))
    gate.resolve()
    await tick()
    equal(stash.length, 1)
  } finally {
    gate.resolve()
    host.close()
    net.client.close()
  }
})

test('completion accepts candidates and an old account answer cannot cross accounts', async () => {
  let net = remote(), by = signal(mint()), answer = deferred<Result>()
  let host = commandField(
    net,
    () => by.value,
    (text) =>
      text == '/late' ? answer.promise : {
        from: 0,
        to: text.length,
        cands: text == '/l' ? [{ text: '/look', kind: 'command' }] : [],
        whole: false,
      },
    { vault: false, stash: storage(), pace: 0 },
  )
  try {
    await host.ready
    host.fields.type('chat', '/l')
    equal(host.fields.press('chat', 'Tab'), true)
    equal(host.drafts.text('chat'), '/look')
    host.fields.type('chat', '/late')
    by.value = mint()
    host.fields.set('chat', '/late')
    answer.resolve({
      from: 0,
      to: 5,
      cands: [{ text: '/wrong', kind: 'command' }],
      whole: false,
    })
    await tick()
    equal(host.fields.row('chat')?.cands, [])
  } finally {
    host.close()
    net.client.close()
  }
})

test('close before ready does not reopen the desk or write stored drafts', async () => {
  let net = remote(), by = signal(mint()), loaded = deferred<Saved[]>()
  let host = commandField(net, () => by.value, empty, {
    vault: { ...vaultStash(), load: () => loaded.promise },
    stash: storage(),
  })
  host.close()
  loaded.resolve([saved(by.value, 'stored')])
  await host.ready
  by.value = mint()
  host.drafts.type('chat', 'closed')
  equal(net.client.read('.draft'), [])
  equal(host.drafts.text('chat'), '')
  net.client.close()
})

test('close keeps unacknowledged edits and blocks late completion writes', async () => {
  let net = remote(),
    by = mint(),
    gate = deferred<void>(),
    answer = deferred<Result>(),
    stash = storage()
  let mutate = net.client.mutate, writes = 0
  net.client.mutate = (rows) => {
    if (!rows.some((b) => b.draft)) return mutate(rows)
    writes++
    return gate.promise.then(() => mutate(rows))
  }
  let host = commandField(net, () => by, () => answer.promise, {
    vault: false,
    stash,
    pace: 0,
  })
  try {
    await host.ready
    host.fields.type('chat', 'first')
    host.fields.type('chat', 'newer')
    host.close()
    gate.resolve()
    answer.resolve(empty('', 0))
    await tick()
    equal(writes, 1)
    equal(stash.length, 1)
    let reloaded = commandField(net, () => by, empty, {
      vault: false,
      stash,
      pace: 0,
    })
    await reloaded.ready
    equal(reloaded.drafts.text('chat'), 'newer')
    await tick()
    equal(stash.length, 0)
    reloaded.close()
  } finally {
    gate.resolve()
    host.close()
    net.client.close()
  }
})

test('legacy command copy stays until server receipt and survives a refused send', async () => {
  let net = remote(),
    by = mint(),
    stash = storage(),
    vault = vaultStash([saved(by, 'precious')])
  let gate = deferred<void>(), mutate = net.client.mutate, refused = true
  net.client.mutate = (rows) => {
    if (!rows.some((b) => b.draft)) return mutate(rows)
    return gate.promise.then(() => {
      if (refused) throw new Error('refused')
      return mutate(rows)
    })
  }
  let host = commandField(net, () => by, empty, {
    vault,
    stash,
    pace: 0,
    report: () => {},
  })
  try {
    await host.ready
    equal((await vault.load()).length, 1)
    let sent = host.drafts.spend('chat')
    equal(stash.length, 1)
    equal((await vault.load()).length, 1)
    gate.resolve()
    equal(await sent, false)
    equal(host.drafts.text('chat'), 'precious')
    equal((await vault.load()).length, 1)
    refused = false
    host.drafts.type('chat', 'precious next')
    await tick()
    equal(await vault.load(), [])
    equal(stash.length, 0)
  } finally {
    gate.resolve()
    host.close()
    net.client.close()
  }
})

test('migration preserves edits a kept page makes while the store receipt waits', async () => {
  let net = remote(),
    by = mint(),
    vault = vaultStash([saved(by, 'precious')]),
    gate = deferred<void>()
  let mutate = net.client.mutate, writes = 0
  net.client.mutate = (rows) => {
    if (!rows.some((b) => b.draft)) return mutate(rows)
    return ++writes == 1 ? gate.promise.then(() => mutate(rows)) : mutate(rows)
  }
  let host = commandField(net, () => by, empty, {
    vault,
    stash: storage(),
    pace: 0,
  })
  try {
    await host.ready
    await vault.save([saved(by, 'precious from old page')])
    gate.resolve()
    await tick()
    equal(host.drafts.text('chat'), 'precious from old page')
    equal(
      comp(net.client.ent(draftEid(by, 'chat')), 'draft').text,
      'precious from old page',
    )
    equal(await vault.load(), [])
  } finally {
    gate.resolve()
    host.close()
    net.client.close()
  }
})

test('command draft emergency stashes do not cross app installations', async () => {
  let store = storage(), by = mint(), a = remote(), b = remote()
  let mutate = a.client.mutate
  a.client.mutate = (rows) =>
    rows.some((b) => b.draft) ? new Promise(() => {}) : mutate(rows)
  let first = commandField(
    { ...a, store: 'https://example.test/vale/api/' },
    () => by,
    empty,
    { vault: false, stash: store, pace: 0 },
  )
  let second = commandField(
    { ...b, store: 'https://example.test/other-vale/api/' },
    () => by,
    empty,
    { vault: false, stash: store, pace: 0 },
  )
  try {
    await Promise.all([first.ready, second.ready])
    first.drafts.type('chat', 'only first app')
    equal(second.drafts.text('chat'), '')
    equal(store.length, 1)
  } finally {
    first.close()
    second.close()
    a.client.close()
    b.client.close()
  }
})
