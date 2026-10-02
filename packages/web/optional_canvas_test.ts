import { test } from '@yaks/testing'
import { tick, until } from './testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { learn, vocab } from './types.ts'
import {
  cache,
  clientSubscription,
  config,
  ent,
  homeless,
  makeHome,
  myActor,
  owner,
  replayOutbox,
  rootCanvas,
  useOutboxStore,
} from './live.ts'
import { actionsFor, applicable, resolve } from './components/registry.ts'
import { screenTarget } from './components/nav.tsx'
import { Entity } from './components/Entity.tsx'
import { mount } from './components/mount.ts'
import { host } from './host_testing.ts'

let docs = vocab.docs
let without = docs.filter((d) =>
  (d as { package?: string }).package != '@yaks/canvas'
)
let fixture = () => {
  cache.value = {
    owner: {
      entity: { eid: 'owner', num: 1 },
      person: { eid: 'owner' },
      doc: { eid: 'owner', title: 'Owner' },
    },
    other: {
      entity: { eid: 'other', num: 2 },
      person: { eid: 'other' },
      doc: { eid: 'other', title: 'Other' },
    },
    task: {
      entity: { eid: 'task', num: 123 },
      task: { eid: 'task' },
      doc: { eid: 'task', title: 'Work' },
    },
    canvas: { entity: { eid: 'canvas', num: 3 }, canvas: { eid: 'canvas' } },
    layout: {
      entity: { eid: 'layout', num: 4 },
      layout: { eid: 'layout', root: 'pane' },
      doc: { eid: 'layout', title: 'Tiles' },
    },
  }
  owner.value = 'owner'
}

test('without canvas, home reads the configured owner inbox and entity links still resolve', () => {
  learn(without)
  fixture()
  try {
    assertEquals(screenTarget('/'), { eid: 'owner', view: 'Inbox' })
    assertEquals(myActor(), 'owner')
    assertEquals(screenTarget('/?v=Canvas'), { eid: 'owner', view: 'Inbox' })
    assertEquals(screenTarget('/T-123'), { eid: 'task', view: undefined })
    let mounted = mount(h(Entity, { eid: 'owner', view: 'Inbox' }))
    try {
      assertEquals(mounted.root.textContent?.includes('Needs you'), true)
      assertEquals(mounted.root.textContent?.includes('Loading inbox…'), true)
    } finally {
      mounted.free()
    }
  } finally {
    learn(docs)
    owner.value = undefined
    cache.value = {}
  }
})

test('canvas contributions disappear without changing the stored entities', async () => {
  for (let installed of [false, true]) {
    learn(installed ? docs : without)
    fixture()
    let prior = config.host
    config.host = 'browser.test'
    let wire = host(() => ({ bundles: [] }))
    try {
      assertEquals(applicable(ent('canvas')).includes('Canvas'), installed)
      assertEquals(applicable(ent('canvas')).includes('List'), installed)
      assertEquals(applicable(ent('canvas')).includes('Split'), installed)
      assertEquals(applicable(ent('layout')).includes('Layout'), installed)
      assertEquals(
        actionsFor(ent('task')).some((a) => a.label == 'open in tray'),
        installed,
      )
      assertEquals(resolve(ent('task')).view, 'Full')
      rootCanvas()
      clientSubscription('client')
      makeHome()
      if (installed) await until(() => wire.asked().length > 0)
      else await tick()
      assertEquals(
        wire.asked().some((a) =>
          /\.(canvas|camera|cursor|fold|shelf)\b/.test(a.subscribe)
        ),
        installed,
      )
      if (!installed) {
        assertEquals(homeless(), false)
        assertEquals(cache.peek().canvas?.canvas, { eid: 'canvas' })
      }
    } finally {
      wire.free()
      config.host = prior
      learn(docs)
      owner.value = undefined
      cache.value = {}
    }
  }
})

test('a cold web module graph loads without canvas', async () => {
  let types = new URL('./types.ts', import.meta.url).href
  let app = new URL('./components/App.tsx', import.meta.url).href
  let code = `let {learn} = await import(${JSON.stringify(types)}); learn(${
    JSON.stringify(without)
  }); await import(${JSON.stringify(app)})`
  let file = await Deno.makeTempFile({ suffix: '.ts' })
  try {
    await Deno.writeTextFile(file, code)
    let result = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        '--config',
        new URL('../../deno.json', import.meta.url).pathname,
        file,
      ],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(result.success, true, new TextDecoder().decode(result.stderr))
  } finally {
    await Deno.remove(file)
  }
})

test('uninstalled-plugin edits stay parked without being replayed or cleared', async () => {
  learn(without)
  let removed: string[] = []
  let previous = useOutboxStore({
    park: () => {},
    unpark: (id) => {
      removed.push(id)
    },
    parked: () =>
      Promise.resolve([['missing-plugin-edit', {
        at: Date.now(),
        changes: [{ eid: 'canvas', name: 'canvas', comp: {} }],
      }]]),
  })
  let wire = host()
  try {
    await replayOutbox()
    await tick()
    assertEquals(wire.sent, [])
    assertEquals(removed, [])
  } finally {
    wire.free()
    useOutboxStore(previous)
    learn(docs)
  }
})
