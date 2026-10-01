import { signal } from '@preact/signals'
import {
  client,
  type Saved,
  stash as vaultStash,
  type Vault,
} from '@yaks/client'
import { draftDoc, draftEid, type Stash } from '@yaks/draft'
import { mint } from '@yaks/graph'
import { equal, ok, test, tick, until } from '@yaks/testing'
import type { Result } from '@yaks/ux/completion'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { commandField } from './command-field.ts'

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
let remote = () => ({ client: client(loadVocab([]), [], { vault: false }) })
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

test('acknowledged command drafts survive reload without the emergency stash', async () => {
  let net = remote()
  let by = mint()
  let vault = vaultStash()
  let stash = storage()
  let a = commandField(net, () => by, empty, { vault, stash, pace: 0 })
  try {
    await a.ready
    a.fields.type('chat', '/look around')
    await until(() => stash.length == 0, { label: 'draft acknowledged' })
    let records = await vault.load()
    equal(records.length, 1)
    equal(Object.keys(records[0].comps), ['draft'])
    equal(records[0].comps.draft?.text, '/look around')
    // Neither the remote schema nor the exported draft schema was changed.
    equal(net.client.vocab.comp('Completion'), undefined)
    equal(net.client.read('*'), [])
    equal(draftDoc.$defs?.draft.sync, undefined)
    a.close()
    let b = commandField(net, () => by, empty, { vault, stash })
    try {
      await b.ready
      equal(b.fields.text('chat'), '/look around')
      equal(b.fields.row('chat')?.cands, [])
      b.drafts.spend('chat')
      await until(() => b.drafts.text('chat') == '' && stash.length == 0)
    } finally {
      b.close()
    }
    let c = commandField(net, () => by, empty, { vault, stash })
    try {
      await c.ready
      equal(c.fields.text('chat'), '')
    } finally {
      c.close()
    }
  } finally {
    a.close()
    net.client.close()
  }
})

test('binding before hydration cannot replace a saved draft with empty input', async () => {
  let net = remote()
  let by = mint()
  let loaded = deferred<Saved[]>()
  let vault = vaultStash([saved(by, '/restored')])
  let saves: Saved[] = []
  let host = commandField(net, () => by, empty, {
    vault: {
      ...vault,
      load: () => loaded.promise,
      save: (rows) => {
        saves.push(...rows)
        return vault.save(rows)
      },
    },
    stash: storage(),
  })
  let { document } = parseHTML('<input>')
  let input = document.querySelector('input')!
  input.setSelectionRange = (from, to) => {
    input.selectionStart = from
    input.selectionEnd = to
  }
  let off = host.fields.bind('chat', input)
  try {
    host.fields.set('chat', '')
    await tick()
    equal(saves, [])
    loaded.resolve(await vault.load())
    await host.ready
    equal(host.drafts.text('chat'), '/restored')
    equal(input.value, '/restored')
    equal(saves, [])
  } finally {
    off()
    host.close()
    net.client.close()
  }
})

test('switching accounts isolates held drafts and clears choices and signed-out input', async () => {
  let net = remote()
  let a = mint()
  let b = mint()
  let by = signal<string | null>(a)
  let vault = vaultStash([saved(b, 'B saved')])
  let stash = storage()
  let host = commandField(net, () => by.value, (text) => ({
    from: 0,
    to: text.length,
    cands: [{ text: '/look', kind: 'command' }],
    whole: false,
  }), { vault, stash, pace: 0 })
  let { document } = parseHTML('<input>')
  let input = document.querySelector('input')!
  input.setSelectionRange = (from, to) => {
    input.selectionStart = from
    input.selectionEnd = to
  }
  let off = host.fields.bind('chat', input)
  try {
    await host.ready
    host.fields.type('chat', 'A held')
    ok(host.fields.row('chat')?.cands.length)
    by.value = b
    equal(host.fields.text('chat'), 'B saved')
    equal(input.value, 'B saved')
    equal(host.fields.row('chat')?.cands, [])
    host.fields.set('chat', 'B held')
    by.value = null
    equal(host.drafts.text('chat'), '')
    equal(input.value, '')
    host.fields.type('chat', 'not signed in')
    by.value = a
    equal(host.fields.text('chat'), 'A held')
    by.value = b
    equal(host.fields.text('chat'), 'B held')
    await until(() => stash.length == 0)
    let rows = await vault.load()
    equal(
      rows.find((r) => r.eid == draftEid(a, 'chat'))?.comps.draft?.text,
      'A held',
    )
    equal(
      rows.find((r) => r.eid == draftEid(b, 'chat'))?.comps.draft?.text,
      'B held',
    )
  } finally {
    off()
    host.close()
    net.client.close()
  }
})

test('emergency stashes are scoped to the app and account', async () => {
  let net = remote()
  let by = signal(mint())
  let a = by.value
  let b = mint()
  let stash = storage()
  stash.setItem(
    'draft:chat',
    JSON.stringify({ text: 'other app', over: '', rev: 0 }),
  )
  let wrote = deferred<void>()
  let vault = vaultStash()
  let blocked: Vault = {
    ...vault,
    save: async (rows) => {
      await wrote.promise
      await vault.save(rows)
    },
  }
  let host = commandField(net, () => by.value, empty, { vault: blocked, stash })
  try {
    await host.ready
    equal(host.drafts.text('chat'), '')
    host.fields.type('chat', 'A unacknowledged')
    by.value = b
    equal(host.drafts.text('chat'), '')
    host.fields.type('chat', 'B unacknowledged')
    equal(stash.length, 3)
    ok(stash.getItem(`vale:commands:${a}:draft:chat`))
    ok(stash.getItem(`vale:commands:${b}:draft:chat`))
    wrote.resolve()
    await until(() => stash.length == 1)
    ok(stash.getItem('draft:chat'))
  } finally {
    wrote.resolve()
    host.close()
    net.client.close()
  }
})

test('completion accepts candidates and an old account answer cannot cross accounts', async () => {
  let net = remote()
  let by = signal(mint())
  let answer = deferred<Result>()
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
    { vault: vaultStash(), stash: storage(), pace: 0 },
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
  let net = remote()
  let by = signal(mint())
  let loaded = deferred<Saved[]>()
  let writes = 0
  let vault = vaultStash()
  let host = commandField(net, () => by.value, empty, {
    vault: {
      ...vault,
      load: () => loaded.promise,
      save: (rows) => {
        writes++
        return vault.save(rows)
      },
    },
    stash: storage(),
  })
  host.close()
  host.close()
  loaded.resolve([saved(by.value, 'stored')])
  await host.ready
  by.value = mint()
  host.drafts.type('chat', 'closed')
  await tick()
  equal(writes, 0)
  equal(host.drafts.text('chat'), '')
  net.client.close()
})

test('close keeps unacknowledged edits and blocks late completion writes', async () => {
  let net = remote()
  let by = mint()
  let gate = deferred<void>()
  let answer = deferred<Result>()
  let stash = storage()
  let kept = vaultStash()
  let writes = 0
  let vault: Vault = {
    ...kept,
    save: async (rows) => {
      writes++
      await gate.promise
      await kept.save(rows)
    },
  }
  let host = commandField(net, () => by, () => answer.promise, {
    vault,
    stash,
    pace: 0,
  })
  try {
    await host.ready
    host.fields.type('chat', 'first')
    host.fields.type('chat', 'newer')
    equal(writes, 1)
    host.close()
    gate.resolve()
    answer.resolve({
      from: 0,
      to: 5,
      cands: [{ text: 'late', kind: 'command' }],
      whole: false,
    })
    await tick()
    equal(writes, 1)
    equal(stash.length, 1)
    host.fields.set('chat', 'after close')
    equal(host.drafts.text('chat'), 'newer')
    let reloaded = commandField(net, () => by, empty, { vault, stash, pace: 0 })
    try {
      await reloaded.ready
      equal(reloaded.drafts.text('chat'), 'newer')
      await until(() => stash.length == 0)
      equal((await vault.load())[0].comps.draft?.text, 'newer')
    } finally {
      reloaded.close()
    }
  } finally {
    gate.resolve()
    host.close()
    net.client.close()
  }
})
