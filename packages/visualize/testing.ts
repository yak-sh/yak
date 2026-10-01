/** Value-free fixtures and manual timers for the MRI doors. No host is booted. */
import type { Anatomy, AnatomyPart } from '@yaks/code/anatomy'
import type { Activity } from './activity.ts'
import { http, type Hosting } from './http.ts'

export let part = (
  id: string,
  name: string,
  more: Partial<AnatomyPart> = {},
): AnatomyPart => ({
  id, name, declared: true, loaded: true, bound: true, ...more,
})

export let emptyAnatomy = (host = 'native'): Anatomy => ({
  version: 1, host,
  packages: [], roles: [], facets: [], comps: [], tools: [], commands: [],
  effects: [], rules: [], hooks: [], routes: [], views: [], inspectViews: [],
  tui: [], kits: [], themes: [], skills: [], secrets: [], edges: [],
})

/** Ten parts, across distinct categories, and four endpoint-valid relations. */
export let anatomy = (): Anatomy => ({
  ...emptyAnatomy(),
  packages: [
    { ...part('package:core', 'Core engine'), configured: true },
    { ...part('package:ui', 'Presentation'), configured: true },
  ],
  facets: [{
    ...part('facet:http', 'HTTP interface', {
      package: '@fixture/core', facet: 'routes',
    }), selected: true, attempted: true,
  }],
  tools: [
    { ...part('tool:load', 'Load part', {
      package: '@fixture/core', facet: 'tools',
      description: 'Follow a causal path by metadata.',
    }), inputSchema: { type: 'object' } },
    { ...part('tool:render', 'Render report', {
      package: '@fixture/ui', facet: 'tools',
    }), inputSchema: { type: 'object' } },
  ],
  commands: [{
    ...part('command:visualize', 'visualize', { package: '@fixture/ui' }),
  }],
  effects: [{
    ...part('effect:deliver', 'deliver', { package: '@fixture/core' }),
    handler: 'delivery', noop: false,
  }],
  rules: [{
    ...part('rule:stamp', 'stamp', { package: '@fixture/core' }), hooks: ['stamp'],
  }],
  routes: [{
    ...part('route:parts', 'Inspect parts', {
      package: '@fixture/core', facet: 'routes',
    }), method: 'GET', path: '/parts',
  }],
  secrets: [part('secret:token', 'API_TOKEN', {
    package: '@fixture/core', bound: false,
  })],
  edges: [
    { id: 'edge:load', from: 'package:core', to: 'tool:load', kind: 'declares' },
    { id: 'edge:render', from: 'package:ui', to: 'tool:render', kind: 'declares' },
    { id: 'edge:route', from: 'facet:http', to: 'route:parts', kind: 'binds' },
    { id: 'edge:token', from: 'package:core', to: 'secret:token', kind: 'names' },
  ],
})

export let req = (path: string, opts: RequestInit = {}) =>
  new Request(`http://mri.test${path}`, opts)

export let door = (host: Hosting, path: string, opts: RequestInit = {}) => {
  let route = http(host).find((r) => r.path == new URL(req(path)).pathname)
  if (!route) throw new Error('fixture requested an unknown door')
  return Promise.resolve(route.handle(req(path, opts)))
}

export type Frame = {
  type: string
  id?: string
  data: Record<string, unknown>
}
export let frame = (bytes: Uint8Array): Frame => {
  let fields = Object.fromEntries(new TextDecoder().decode(bytes).trim()
    .split('\n').map((line) => {
      let at = line.indexOf(':')
      return [line.slice(0, at), line.slice(at + 1).trimStart()]
    }))
  return { type: fields.event, id: fields.id, data: JSON.parse(fields.data) }
}
export let readFrame = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Frame> => {
  let next = await reader.read()
  if (next.done) throw new Error('stream closed before its expected frame')
  return frame(next.value)
}
export let recorded = (value: Frame): Activity => value.data as unknown as Activity

export let reasonOf = async (waiting: Promise<unknown>): Promise<unknown> => {
  try {
    await waiting
  } catch (reason) {
    return reason
  }
  throw new Error('expected cancellation to reject')
}

type Timer = { kind: 'timeout' | 'interval'; ms: number; run: () => void }
/** Replace only timers, not a server or clock. Each test restores in finally.
 * Capture completion and keepalives can be driven by facts, without sleeps. */
export let manualTimers = () => {
  let keys = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
  let saved = keys.map((key) => [key,
    Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  let pending = new Map<number, Timer>()
  let scheduled: { id: number; kind: Timer['kind']; ms: number }[] = []
  let next = 0
  let install = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, {
      value, configurable: true, writable: true,
    })
  let make = (kind: Timer['kind']) => (
    callback: (...args: unknown[]) => void,
    ms = 0,
    ...args: unknown[]
  ) => {
    let id = ++next
    pending.set(id, { kind, ms, run: () => callback(...args) })
    scheduled.push({ id, kind, ms })
    return id
  }
  install('setTimeout', make('timeout'))
  install('setInterval', make('interval'))
  install('clearTimeout', (id: number) => pending.delete(id))
  install('clearInterval', (id: number) => pending.delete(id))
  return {
    pending, scheduled,
    fire: (id: number) => {
      let timer = pending.get(id)
      if (!timer) throw new Error('fixture fired a missing timer')
      if (timer.kind == 'timeout') pending.delete(id)
      timer.run()
    },
    restore: () => {
      for (let [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
      pending.clear()
    },
  }
}

/** A coarse runtime clock demonstrates that a duration of zero is data. */
export let fixedNow = (value = 0) => {
  let saved = Object.getOwnPropertyDescriptor(performance, 'now')
  Object.defineProperty(performance, 'now', {
    value: () => value, configurable: true, writable: true,
  })
  return () => {
    if (saved) Object.defineProperty(performance, 'now', saved)
    else Reflect.deleteProperty(performance, 'now')
  }
}
