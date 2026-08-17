// The Configuration client keeps the two planes honest: a non-secret setting is
// edited by a graph write and confirmed by re-reading its effective source; a
// secret never carries a value, only its state.
import { assert, assertEquals } from '@std/assert'
import type { Change } from './types.ts'
import type { SettingRow } from './config.ts'
import type { CredStatus } from './credentials.ts'
import { config, type CredsDoor, type SettingsDoor } from './config_client.ts'

// A settings plane that a graph write mutates, the way the server's apply() +
// broadcast would: writing a `setting` flips the row to source 'graph'; deleting
// it reveals the environment again.
let fakeSettings = () => {
  let store: Record<
    string,
    { value: string; source: SettingRow['source']; eid?: string }
  > = {
    OLLAMA_BASE_URL: { value: 'https://env.example/', source: 'environment' },
  }
  let door: SettingsDoor = {
    list: () =>
      Promise.resolve([{
        key: 'OLLAMA_BASE_URL',
        label: 'Ollama base URL',
        group: 'ollama',
        type: 'url',
        help: 'base url',
        default: 'https://ollama.yak.sh',
        value: store.OLLAMA_BASE_URL.value,
        source: store.OLLAMA_BASE_URL.source,
        ...(store.OLLAMA_BASE_URL.eid
          ? { eid: store.OLLAMA_BASE_URL.eid }
          : {}),
      }]),
  }
  let writes: Change[] = []
  let write = (...changes: Change[]) => {
    writes.push(...changes)
    for (let c of changes) {
      if (c.name != 'setting') continue
      if (c.comp == null) {
        store.OLLAMA_BASE_URL = {
          value: 'https://env.example/',
          source: 'environment',
        }
      } else {
        store.OLLAMA_BASE_URL = {
          value: String(c.comp.value),
          source: 'graph',
          eid: c.eid,
        }
      }
    }
  }
  return { door, write, writes }
}

let fakeCreds = () => {
  let state: CredStatus = {
    key: 'OLLAMA_API_KEY',
    state: 'missing',
    source: null,
  }
  let seen: { value?: string; reference?: string } = {}
  let door: CredsDoor = {
    list: () => Promise.resolve([state]),
    save: (_key, value) => {
      seen.value = value
      state = { key: 'OLLAMA_API_KEY', state: 'configured', source: 'local' }
      return Promise.resolve(state)
    },
    bind: (_key, reference) => {
      seen.reference = reference
      state = { key: 'OLLAMA_API_KEY', state: 'configured', source: 'op' }
      return Promise.resolve(state)
    },
    reset: () => {
      state = { key: 'OLLAMA_API_KEY', state: 'missing', source: null }
      return Promise.resolve(state)
    },
    refresh: () => Promise.resolve(state),
    test: () =>
      Promise.resolve({
        key: 'OLLAMA_API_KEY',
        state: 'unavailable',
        source: 'local',
        detail: 'probe refused',
      }),
  }
  return { door, seen }
}

// A `later` that resolves on a microtask, so settle's poll loop runs without a
// real timer (no leak, instant test).
let soon = (run: () => void) => {
  queueMicrotask(run)
  return 0 as unknown as ReturnType<typeof setTimeout>
}

let control = (
  settings = fakeSettings(),
  creds = fakeCreds(),
  write = settings.write,
) => ({
  ...settings,
  ...creds,
  ctl: config(
    settings.door,
    creds.door,
    write,
    () => 'minted-eid',
    soon,
    0,
  ),
})

Deno.test('read loads both planes', async () => {
  let c = control()
  await c.ctl.read()
  let v = c.ctl.view.value
  assertEquals(v.settings?.[0].key, 'OLLAMA_BASE_URL')
  assertEquals(v.settings?.[0].source, 'environment')
  assertEquals(v.creds?.[0].key, 'OLLAMA_API_KEY')
  assertEquals(v.creds?.[0].state, 'missing')
  c.ctl.close()
})

Deno.test('saving a setting writes a graph override and the source becomes graph', async () => {
  let c = control()
  await c.ctl.read()
  await c.ctl.saveSetting('OLLAMA_BASE_URL', 'https://host.example/')
  let write = c.writes.find((w) => w.name == 'setting')
  assert(write, 'a setting change was written')
  assertEquals(write!.eid, 'minted-eid')
  // The url type is normalized on the way in (trailing slash dropped).
  assertEquals(write!.comp, {
    key: 'OLLAMA_BASE_URL',
    value: 'https://host.example',
  })
  let row = c.ctl.view.value.settings?.[0]
  assertEquals(row?.source, 'graph')
  assertEquals(row?.value, 'https://host.example')
  assertEquals(c.ctl.view.value.busy, undefined)
  c.ctl.close()
})

Deno.test('an invalid value is refused before any write', async () => {
  let c = control()
  await c.ctl.read()
  await c.ctl.saveSetting('OLLAMA_BASE_URL', 'not a url')
  assertEquals(c.writes.length, 0)
  assert(c.ctl.view.value.rowError['OLLAMA_BASE_URL'])
  c.ctl.close()
})

Deno.test('resetting an override deletes the component and reveals the environment', async () => {
  let c = control()
  await c.ctl.read()
  await c.ctl.saveSetting('OLLAMA_BASE_URL', 'https://host.example/')
  await c.ctl.resetSetting('OLLAMA_BASE_URL')
  let del = c.writes.find((w) => w.name == 'setting' && w.comp == null)
  assert(del, 'the override component was deleted')
  assertEquals(del!.eid, 'minted-eid')
  assertEquals(c.ctl.view.value.settings?.[0].source, 'environment')
  c.ctl.close()
})

Deno.test('saving a credential sends the value but never keeps it in view', async () => {
  let c = control()
  await c.ctl.read()
  await c.ctl.saveCred('OLLAMA_API_KEY', 'sk-secret')
  assertEquals(c.seen.value, 'sk-secret')
  let cred = c.ctl.view.value.creds?.[0]
  assertEquals(cred?.state, 'configured')
  assertEquals(cred?.source, 'local')
  // No value/reference field ever rides on the stored status.
  assertEquals('value' in (cred as Record<string, unknown>), false)
  c.ctl.close()
})

Deno.test('binding a credential to op:// records only the reference', async () => {
  let c = control()
  await c.ctl.read()
  await c.ctl.bindCred('OLLAMA_API_KEY', 'op://vault/item/field')
  assertEquals(c.seen.reference, 'op://vault/item/field')
  assertEquals(c.ctl.view.value.creds?.[0].source, 'op')
  c.ctl.close()
})

Deno.test('a failing test surfaces the scrubbed detail on the row', async () => {
  let c = control()
  await c.ctl.read()
  await c.ctl.testCred('OLLAMA_API_KEY')
  let cred = c.ctl.view.value.creds?.[0]
  assertEquals(cred?.state, 'unavailable')
  assertEquals(cred?.detail, 'probe refused')
  c.ctl.close()
})
