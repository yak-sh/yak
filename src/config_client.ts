// The client half of the Configuration panel: one view over the server's two
// configuration planes. The NON-secret plane is read from GET /config/settings
// (its effective value, which plane answered, and the existing `setting` eid a
// save targets) and edited by an ordinary graph `setting` write — so a save
// rides the normal mutation + broadcast path and reaches every client. The
// SECRET plane never crosses the wire as a value: only its STATE
// (configured / missing / unavailable), a source, and a scrubbed diagnostic are
// read from /config/credentials, and a write consumes its input — nothing here
// echoes or prefills a secret. Drafts live only in the mounted UI, never in this
// controller.
import { signal } from '@preact/signals'
import type { Change } from './types.ts'
import type { SettingRow, SettingType, Source } from './config.ts'
import { validate } from './config.ts'
import type { CredSource, CredState, CredStatus } from './credentials.ts'
import { base, mutate, uuid } from './live.ts'

export type { CredSource, CredState, CredStatus, SettingRow, SettingType }

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
type Timer = ReturnType<typeof setTimeout>
type Later = (run: () => void, ms: number) => Timer

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let str = (value: unknown, max: number): string | undefined =>
  typeof value == 'string' && value.length <= max ? value : undefined

let sources = new Set<Source>(['graph', 'environment', 'default'])
let types = new Set<SettingType>(['url', 'text'])

// A malformed row is dropped, not thrown — one bad entry must never blank the
// whole panel. Every string is bounded so a runaway field can't wedge the DOM.
let settingRow = (value: unknown): SettingRow | undefined => {
  if (!record(value)) return
  let key = str(value.key, 128)
  let label = str(value.label, 200)
  let group = str(value.group, 64)
  let help = str(value.help, 4096)
  let type = types.has(value.type as SettingType)
    ? value.type as SettingType
    : undefined
  let source = sources.has(value.source as Source)
    ? value.source as Source
    : undefined
  if (key == null || label == null || group == null || help == null) return
  if (!type || !source) return
  let val = str(value.value, 8192)
  let dflt = str(value.default, 8192)
  let eid = str(value.eid, 64)
  return {
    key,
    label,
    group,
    type,
    help,
    source,
    ...(val == null ? {} : { value: val }),
    ...(dflt == null ? {} : { default: dflt }),
    ...(eid == null ? {} : { eid }),
  }
}

let states = new Set<CredState>(['configured', 'missing', 'unavailable'])
let credSources = new Set(['local', 'op', 'environment'])

let credStatus = (value: unknown): CredStatus | undefined => {
  if (!record(value)) return
  let key = str(value.key, 128)
  let state = states.has(value.state as CredState)
    ? value.state as CredState
    : undefined
  if (key == null || !state) return
  let source: CredSource = credSources.has(value.source as string)
    ? value.source as CredSource
    : null
  let detail = str(value.detail, 500)
  return { key, state, source, ...(detail == null ? {} : { detail }) }
}

let list = <T>(value: unknown, parse: (v: unknown) => T | undefined): T[] =>
  Array.isArray(value)
    ? value.map(parse).filter((row): row is T => row != null)
    : []

// A request that failed carries the server's scrubbed reason (accounts/creds
// answer `{ error: { code, message } }`), never a raw stack.
let problem = (value: unknown): string => {
  if (record(value) && record(value.error)) {
    let message = str(value.error.message, 500)
    if (message) return message
  }
  return 'The configuration request failed.'
}

export type SettingsDoor = { list: () => Promise<SettingRow[]> }

export let settingsDoor = (
  run: Fetch = fetch,
  root: () => string = base,
): SettingsDoor => ({
  list: async () => {
    let res = await run(`${root()}/config/settings`, { cache: 'no-store' })
    let value = await res.json()
    if (!res.ok) throw Error(problem(value))
    return list(value, settingRow)
  },
})

export type CredsDoor = {
  list: () => Promise<CredStatus[]>
  save: (key: string, value: string) => Promise<CredStatus>
  bind: (key: string, reference: string) => Promise<CredStatus>
  reset: (key: string) => Promise<CredStatus>
  refresh: (key: string) => Promise<CredStatus>
  test: (key: string) => Promise<CredStatus>
}

export let credsDoor = (
  run: Fetch = fetch,
  root: () => string = base,
): CredsDoor => {
  let ask = async (path: string, body?: unknown) => {
    let res = await run(
      `${root()}/config/credentials${path}`,
      body == null ? { cache: 'no-store' } : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    let value = await res.json()
    if (!res.ok) throw Error(problem(value))
    return value
  }
  let one = async (path: string, body?: unknown) => {
    let status = credStatus(await ask(path, body))
    if (!status) {
      throw Error('The credential store returned an unreadable state.')
    }
    return status
  }
  return {
    list: async () => list(await ask(''), credStatus),
    // A local plaintext secret and an op:// binding are the two backends; one
    // field decides which. Neither the value nor the reference is ever read back.
    save: (key, value) => one(`/${encodeURIComponent(key)}`, { value }),
    bind: (key, reference) => one(`/${encodeURIComponent(key)}`, { reference }),
    reset: (key) => one(`/${encodeURIComponent(key)}/reset`, {}),
    refresh: (key) => one(`/${encodeURIComponent(key)}/refresh`, {}),
    test: (key) => one(`/${encodeURIComponent(key)}/test`, {}),
  }
}

// The mounted panel reads this one view. `busy` names the row (or 'read')
// currently working so the UI can disable just that control; `rowError` keeps a
// per-key reason visible until the next attempt on that key. Values themselves
// never live here — a non-secret value rides on its SettingRow (from the
// server), a secret has none.
export type ConfigView = {
  settings?: SettingRow[]
  creds?: CredStatus[]
  busy?: string
  error?: string
  rowError: Record<string, string>
}

let message = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'The configuration request failed.'

// A controller remembers only what the server last SAID and which row is in
// flight. A non-secret save is an ordinary graph write (config.ts validates the
// same value the server's apply() will), then a short poll until the effective
// source reflects it — the broadcast round-trip, not a guess. A reset deletes
// the override so the environment or default shows through again.
export let config = (
  settings: SettingsDoor,
  creds: CredsDoor,
  write: (...changes: Change[]) => void = mutate,
  mint: () => string = uuid,
  later: Later = setTimeout,
  delay = 150,
  tries = 12,
) => {
  let view = signal<ConfigView>({ rowError: {} })
  let generation = 0

  let set = (next: Partial<ConfigView>) =>
    view.value = { ...view.peek(), ...next }
  let rowError = (key: string, reason?: string) => {
    let next = { ...view.peek().rowError }
    if (reason == null) delete next[key]
    else next[key] = reason
    set({ rowError: next })
  }

  let read = async () => {
    let mine = ++generation
    set({ busy: 'read', error: undefined })
    try {
      let [s, c] = await Promise.all([settings.list(), creds.list()])
      if (mine != generation) return
      set({ settings: s, creds: c, busy: undefined })
    } catch (error) {
      if (mine != generation) return
      set({ busy: undefined, error: message(error) })
    }
  }

  let sleep = () =>
    new Promise<void>((ok) => {
      let t = later(() => ok(), delay)
      void t
    })

  // Re-read the non-secret plane until `ok` holds for the key (the broadcast
  // landed) or the deadline passes; keep the latest rows either way.
  let settle = async (key: string, ok: (row: SettingRow) => boolean) => {
    for (let n = 0; n < tries; n++) {
      try {
        let rows = await settings.list()
        set({ settings: rows })
        let row = rows.find((r) => r.key == key)
        if (!row || ok(row)) return
      } catch { /* transient; keep polling to the deadline */ }
      await sleep()
    }
  }

  let saveSetting = async (key: string, draft: string) => {
    let row = view.peek().settings?.find((r) => r.key == key)
    if (!row) return
    let clean: string
    try {
      clean = validate(key, draft)
    } catch (error) {
      rowError(key, message(error))
      return
    }
    rowError(key)
    set({ busy: key })
    write({
      eid: row.eid ?? mint(),
      name: 'setting',
      comp: { key, value: clean },
    })
    await settle(key, (r) => r.source == 'graph' && r.value == clean)
    set({ busy: undefined })
  }

  // Reset removes the graph override so the environment (or the catalog default)
  // shows through again. With no override stored there is nothing to remove.
  let resetSetting = async (key: string) => {
    let row = view.peek().settings?.find((r) => r.key == key)
    if (!row?.eid) return
    rowError(key)
    set({ busy: key })
    write({ eid: row.eid, name: 'setting', comp: null })
    await settle(key, (r) => r.source != 'graph')
    set({ busy: undefined })
  }

  let credAct = async (key: string, run: () => Promise<CredStatus>) => {
    rowError(key)
    set({ busy: key })
    try {
      let status = await run()
      let creds = (view.peek().creds ?? []).map((c) =>
        c.key == key ? status : c
      )
      set({ creds, busy: undefined })
    } catch (error) {
      rowError(key, message(error))
      set({ busy: undefined })
    }
  }

  return {
    view,
    read,
    saveSetting,
    resetSetting,
    saveCred: (key: string, value: string) =>
      credAct(key, () => creds.save(key, value)),
    bindCred: (key: string, reference: string) =>
      credAct(key, () => creds.bind(key, reference)),
    resetCred: (key: string) => credAct(key, () => creds.reset(key)),
    refreshCred: (key: string) => credAct(key, () => creds.refresh(key)),
    testCred: (key: string) => credAct(key, () => creds.test(key)),
    close: () => {
      generation++
    },
  }
}

export type ConfigControl = ReturnType<typeof config>

export let configControl = config(settingsDoor(), credsDoor())
