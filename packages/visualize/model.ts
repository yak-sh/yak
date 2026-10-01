/** The page's domain state lives in a local graph, not component state or a
 * second record store. Resource indexes contain only bounded UUID mappings. */
import { signal } from '@preact/signals'
import { client } from '@yaks/client'
import { desk, drafts } from '@yaks/draft'
import { type Bundle, derivedEid, mint } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import type { Activity } from './activity.ts'
import { docs, draftDocs } from './front.ts'
import { type Edge, located, type Node, parts, spine } from './parts.ts'
import { GROUPS, type Snapshot } from './snapshot.ts'
import { type Connection, type Source, stream, valid } from './stream.ts'

export type { Activity, Edge, Node }
export type VisualizeState = {
  selected: string
  cause: string
  filter: string
  group: string
  listPage: number
  paused: boolean
  view: 'map' | 'list'
  theme: 'everforest' | 'rosepine'
  scheme: 'dark' | 'light'
  x: number
  y: number
  zoom: number
  connected: Connection
  gap: number
  received: number
  error: string
  host: string
}
export type AtlasModel = {
  readonly state: VisualizeState
  readonly nodes: Node[]
  readonly edges: Edge[]
  readonly events: Activity[]
  readonly selected: Node | undefined
  readonly cause: Activity[]
  readonly coverage: Snapshot['coverage']['observed']
  set: (patch: Partial<VisualizeState>) => void
  search: (text: string) => void
  select: (id: string) => void
  /** A shared trace span ID, never an event-row UUID. */
  choose: (id: string) => void
  /** Handles failure internally; safe for a UI's void refresh(). */
  refresh: () => Promise<void>
  reset: () => void
  close: () => void
}
export type ModelOptions = {
  base?: string
  fetch?: typeof fetch
  connect?: (url: string) => Source
  scheme?: 'dark' | 'light'
  start?: boolean
}
let initial = (scheme: 'dark' | 'light'): VisualizeState => ({
  selected: '', cause: '', filter: '', group: 'all', listPage: 0,
  paused: false, view: 'map', theme: 'everforest', scheme,
  x: 0, y: 0, zoom: 1, connected: 'connecting',
  gap: 0, received: 0, error: '', host: '',
})
let component = <T>(bundle: Bundle | undefined, key: string) =>
  bundle?.[key] as T | undefined
let latest = (events: Activity[]) => {
  let spans = new Map<string, Activity>()
  for (let event of events) spans.set(event.id, event)
  return spans
}

/** Causality is limited to retained, same-epoch evidence. Missing parents are
 * not guessed. Cycles cannot hang the surface. */
export let causes = (events: Activity[], id: string): Activity[] => {
  let target = events.findLast((event) => event.id == id)
  if (!target) return []
  let spans = latest(events.filter((event) => event.epoch == target.epoch))
  let included = new Set([id])
  let parent = spans.get(id)?.parent
  while (parent && spans.has(parent) && !included.has(parent)) {
    included.add(parent)
    parent = spans.get(parent)?.parent
  }
  for (let event of spans.values()) {
    let seen = new Set<string>()
    let at: string | undefined = event.id
    while (at && !seen.has(at)) {
      if (at == id) { included.add(event.id); break }
      seen.add(at)
      at = spans.get(at)?.parent
    }
  }
  return [...spans.values()].filter((e) => included.has(e.id))
    .sort((a, b) => a.seq - b.seq)
}

/** All observations here are projections of the one producer stream. */
export let atlas = (opts: ModelOptions = {}): AtlasModel => {
  let base = new URL(opts.base ?? globalThis.location?.origin ??
    'http://localhost')
  let page = mint()
  let stateId = derivedEid(`${page}|state`)
  let actor = derivedEid(`${page}|actor`)
  let local = client(loadVocab([...docs, ...draftDocs]), [drafts()], {
    signal, vault: false, wireVault: false,
  })
  let closed = false
  let request: AbortController | undefined
  let feed: { close: () => void } | undefined
  let resumed = false
  let skipGap = false
  let identities = new Map<string, string>()
  // Fixed reusable record slots avoid a trail of deleted event tombstones.
  let slots = Array.from({ length: 256 }, (_, i) => derivedEid(`${page}|${i}`))
  let eventIds = new Map<string, string>()
  let write = (change: Bundle[]) => {
    if (closed || !change.length) return
    let result = local.mutate(change)
    if (result instanceof Promise) {
      void result.catch(() => { if (!closed) console.error('MRI local write') })
    }
  }
  let patch = (value: Record<string, unknown>) => write([
    { entity: { eid: stateId }, Visualize: value },
  ])
  let defaults = Object.fromEntries(Object.entries(initial(opts.scheme ?? 'dark'))
    .filter(([key]) => !['selected', 'cause', 'filter'].includes(key)))
  write([{ entity: { eid: stateId }, Visualize: defaults },
    { entity: { eid: actor }, AtlasCoverage: { scope: 'page', observed: {} } }])
  let stateWatch = local.watch(`.entity.eid=${stateId}&.Visualize`)
  let nodeWatch = local.watch('.AtlasPart')
  let edgeWatch = local.watch('.AtlasRelation')
  let eventWatch = local.watch('.AtlasEvent&.order=AtlasEvent.seq')
  let coverageWatch = local.watch(`.entity.eid=${stateId}&.AtlasCoverage`)
  let typed = desk({
    mutate: (change) => closed ? [] : local.mutate(change),
    watch: (query) => local.watch(query),
  }, { by: () => closed ? undefined : actor, pace: 0 })
  let identity = (id: string) => {
    let eid = identities.get(id)
    if (!eid) identities.set(id, eid = derivedEid(`${page}|part|${id}`))
    return eid
  }
  let publicId = (eid?: string) => {
    let row = eid ? local.ent(eid) : undefined
    return component<Node>(row, 'AtlasPart')?.id ??
      component<Edge>(row, 'AtlasRelation')?.id ?? ''
  }
  let rows = () => eventWatch.value
  let observations = () => rows().map((b) =>
    component<{ data: Activity }>(b, 'AtlasEvent')!.data)
  let spanRef = (id: string) => rows().findLast((b) =>
    component<{ span: string }>(b, 'AtlasEvent')?.span == id)?.entity.eid ?? ''
  let state = (): VisualizeState => {
    let stored = component<VisualizeState>(stateWatch.value[0], 'Visualize')!
    let cause = component<{ span: string }>(stored.cause ? local.ent(stored.cause) : undefined,
      'AtlasEvent')?.span ?? ''
    return { ...initial(opts.scheme ?? 'dark'), ...stored, selected: publicId(stored.selected), cause,
      filter: typed.text('anatomy-search') }
  }
  let clearEvents = (epoch: string) => {
    write([
      ...rows().map((b): Bundle => ({ entity: b.entity, AtlasEvent: null })),
      { entity: { eid: stateId }, Visualize: { cause: null },
        AtlasCoverage: { epoch } },
    ])
    eventIds.clear()
  }
  let epoch = (value: string) => {
    let old = component<{ epoch?: string }>(coverageWatch.value[0],
      'AtlasCoverage')?.epoch
    if (old == value) return
    clearEvents(value)
    if (old && !resumed) {
      patch({ gap: state().gap + 1 })
      skipGap = true
    }
  }
  let accept = (input: Activity) => {
    if (closed || state().paused || !valid(input)) return
    let known = component<{ epoch?: string }>(coverageWatch.value[0],
      'AtlasCoverage')?.epoch
    if (known && known != input.epoch) return
    if (!known) epoch(input.epoch)
    let key = `${input.epoch}:${input.seq}`
    if (eventIds.has(key)) return
    let held = observations()
    let chosen = state().cause
    if (input.seq <= (held.at(-1)?.seq ?? 0)) return
    if (!skipGap && held.length && input.seq > held.at(-1)!.seq + 1) {
      patch({ gap: state().gap + 1 })
    }
    skipGap = false
    let node = located(input, model.nodes)
    let counts = input.counts && Object.fromEntries(
      Object.entries(input.counts).filter(([name, n]) =>
        name.length <= 64 && Number.isFinite(n)).slice(0, 32),
    )
    let event: Activity = {
      id: input.id, parent: input.parent, kind: input.kind, name: input.name,
      stage: input.stage, time: input.time, start: input.start,
      duration: input.duration, outcome: input.outcome,
      package: input.package, plugin: input.plugin, counts,
      seq: input.seq, epoch: input.epoch, node,
    }
    let next = [...held, event].slice(-256)
    let used = new Set(eventIds.values())
    let eid = held.length >= slots.length
      ? eventIds.get(`${held[0].epoch}:${held[0].seq}`)!
      : slots.find((id) => !used.has(id))!
    // Prune the transport UUID index at the same bound as the graph records.
    let keys = new Set(next.map((e) => `${e.epoch}:${e.seq}`))
    for (let old of eventIds.keys()) if (!keys.has(old)) eventIds.delete(old)
    eventIds.set(key, eid)
    let spans = latest(next)
    let ref = (id?: string) => {
      let at = id && spans.get(id)
      return at ? eventIds.get(`${at.epoch}:${at.seq}`) ?? null : null
    }
    let changes: Bundle[] = [{ entity: { eid }, AtlasEvent: {
      seq: event.seq, epoch: event.epoch, span: event.id, data: event,
      node: node ? identity(node) : null, parent: ref(event.parent),
    } }]
    for (let row of rows()) {
      if (row.entity.eid == eid) continue
      let stored = component<{ parent?: string; data: Activity }>(row,
        'AtlasEvent')!
      if (!keys.has(`${stored.data.epoch}:${stored.data.seq}`)) {
        changes.push({ entity: row.entity, AtlasEvent: null })
      } else if ((stored.parent ?? null) != ref(stored.data.parent)) {
        changes.push({ entity: row.entity, AtlasEvent: {
          parent: ref(stored.data.parent),
        } })
      }
    }
    changes.push({ entity: { eid: stateId }, Visualize: {
      received: state().received + 1, cause: ref(chosen),
    } })
    write(changes)
  }
  let start = (tail = false) => {
    if (closed || state().paused || feed) return
    patch({ connected: 'connecting' })
    try {
      feed = stream({
        url: new URL('/visualize/events', base).href, tail,
        connect: opts.connect ?? ((url) => new EventSource(url)),
        epoch: (value) => { epoch(value); resumed = false },
        activity: accept,
        gap: () => {
          if (!resumed && !skipGap) patch({ gap: state().gap + 1 })
          skipGap = true
        },
        status: (connected) => patch({ connected }),
        error: () => patch({ error: 'Invalid observation frame.' }),
      })
    } catch {
      patch({ connected: 'offline', error: 'Activity connection failed.' })
    }
  }
  let model: AtlasModel = {
    get state() { return state() },
    get nodes() { return nodeWatch.value.map((b) =>
      component<Node>(b, 'AtlasPart')!) },
    get edges() { return edgeWatch.value.map((b) => {
      let edge = component<Edge>(b, 'AtlasRelation')!
      return { ...edge, from: publicId(edge.from), to: publicId(edge.to) }
    }) },
    get events() { return observations() },
    get selected() { return model.nodes.find((n) => n.id == state().selected) },
    get cause() { return causes(observations(), state().cause) },
    get coverage() { return component<{ observed: AtlasModel['coverage'] }>(
      coverageWatch.value[0], 'AtlasCoverage')?.observed ?? {} },
    set: (value) => {
      if (closed) return
      let { filter, selected, cause, ...rest } = value
      if (filter != undefined) typed.type('anatomy-search', filter)
      let before = state()
      let next: Record<string, unknown> = { ...rest }
      if (selected != undefined) next.selected = identities.get(selected) ?? null
      if (cause != undefined) next.cause = spanRef(cause) || null
      for (let k of ['x', 'y', 'zoom', 'listPage'] as const) {
        if (value[k] != undefined && !Number.isFinite(value[k])) delete next[k]
      }
      if (typeof next.zoom == 'number') {
        next.zoom = Math.max(.35, Math.min(3, next.zoom))
      }
      if (typeof next.listPage == 'number') {
        next.listPage = Math.max(0, Math.floor(next.listPage))
      }
      if (value.paused != undefined && value.paused != before.paused) {
        if (value.paused) {
          feed?.close()
          feed = undefined
          next.connected = 'paused'
        } else {
          resumed = true
          skipGap = true
          next.gap = before.gap + 1
          next.connected = 'connecting'
        }
      }
      patch(next)
      if (before.paused && value.paused === false) start(true)
    },
    search: (text) => { if (!closed) typed.type('anatomy-search', text) },
    select: (id) => model.set({ selected: id }),
    choose: (id) => model.set({ cause: id }),
    reset: () => model.set({ x: 0, y: 0, zoom: 1 }),
    refresh: async () => {
      if (closed) return
      request?.abort()
      let stop = new AbortController()
      request = stop
      try {
        let response = await (opts.fetch ?? fetch)(
          new URL('/visualize/anatomy', base),
          { signal: stop.signal, credentials: 'same-origin', redirect: 'error' },
        )
        if (!response.ok) throw new Error('anatomy refused')
        let source = await response.json() as Snapshot
        if (closed || stop.signal.aborted) return
        if (source.version != 1 || source.anatomy?.version != 1 ||
          !source.coverage || !GROUPS.every((g) =>
            Array.isArray(source.anatomy[g]))) throw new Error('bad anatomy')
        let nodes = parts(source)
        let current = new Set([...nodes.map((n) => n.id),
          ...source.anatomy.edges.map((e) => e.id)])
        let changes: Bundle[] = []
        for (let row of [...nodeWatch.value, ...edgeWatch.value]) {
          let id = publicId(row.entity.eid)
          if (!current.has(id)) changes.push({ entity: row.entity,
            AtlasPart: null, AtlasRelation: null })
        }
        for (let node of nodes) changes.push({ entity: { eid: identity(node.id) },
          AtlasPart: node })
        for (let edge of source.anatomy.edges) {
          if (!nodes.some((n) => n.id == edge.from) ||
            !nodes.some((n) => n.id == edge.to)) continue
          changes.push({ entity: { eid: identity(edge.id) }, AtlasRelation: {
            ...edge, from: identity(edge.from), to: identity(edge.to),
          } })
        }
        // Relink retained observations when lazy metadata arrives or a part
        // leaves. The measurement, sequence and monotonic time are unchanged.
        for (let row of rows()) {
          let stored = component<{ data: Activity }>(row, 'AtlasEvent')!
          let node = located(stored.data, nodes)
          changes.push({ entity: row.entity, AtlasEvent: {
            data: { ...stored.data, node },
            node: node ? identity(node) : null,
          } })
        }
        changes.push({ entity: { eid: stateId }, Visualize: {
          host: source.coverage.scope, error: '',
          selected: current.has(state().selected)
            ? identities.get(state().selected) ?? null : null,
        }, AtlasCoverage: { scope: source.coverage.scope,
          observed: source.coverage.observed, takenAt: source.takenAt } })
        write(changes)
        for (let id of identities.keys()) if (!current.has(id)) identities.delete(id)
      } catch {
        if (!closed && !stop.signal.aborted) {
          patch({ error: 'Could not read host anatomy. Check access and retry.' })
        }
      } finally {
        if (request == stop) request = undefined
      }
    },
    close: () => {
      if (closed) return
      closed = true
      feed?.close()
      feed = undefined
      request?.abort()
      typed.close()
      for (let watch of [stateWatch, nodeWatch, edgeWatch, eventWatch,
        coverageWatch]) watch.close()
      identities.clear()
      eventIds.clear()
      local.close()
    },
  }
  for (let node of spine()) write([{ entity: { eid: identity(node.id) },
    AtlasPart: node }])
  if (opts.start !== false) {
    start()
    void model.refresh()
  }
  return model
}
