/** The domain's controlled spatial view: fixed lanes, bounded geometry and
 * event-driven pulses. Pointer captures are resources; the camera is graph data.
 */

import { useRef } from 'preact/hooks'
import { Button } from '@yaks/ui'
import type { Activity, AtlasModel, Edge, Node } from './model.ts'

export let NODE_LIMIT = 160
export let EDGE_LIMIT = 320
export let PULSE_LIMIT = 48

export let sections = [
  { id: 'foundation', name: 'Composition', note: 'Packages, roles & facets',
    groups: ['packages', 'roles', 'facets'], color: 'info', mark: '01' },
  { id: 'vocabulary', name: 'Vocabulary', note: 'Components & their contracts',
    groups: ['comps'], color: 'positive', mark: '02' },
  { id: 'automation', name: 'Automation', note: 'Rules, hooks & effects',
    groups: ['phases', 'rules', 'hooks', 'effects'], color: 'active', mark: '03' },
  { id: 'interfaces', name: 'Interfaces', note: 'Tools, commands & routes',
    groups: ['tools', 'commands', 'routes'], color: 'special', mark: '04' },
  { id: 'presentation', name: 'Presentation', note: 'Views, kits & themes',
    groups: ['views', 'inspectViews', 'tui', 'kits', 'themes'],
    color: 'link', mark: '05' },
  { id: 'configuration', name: 'Wiring', note: 'Secret names & skills',
    groups: ['secrets', 'skills'], color: 'caution', mark: '06' },
]

let labels: Record<string, string> = {
  packages: 'Packages', roles: 'Roles', facets: 'Facets', comps: 'Components',
  phases: 'Pipeline labels', rules: 'Rules', hooks: 'Hooks', effects: 'Effects',
  tools: 'Tools', commands: 'Commands', routes: 'Routes', views: 'Views',
  inspectViews: 'Inspector views', tui: 'Terminal views', kits: 'UI kits',
  themes: 'Themes', secrets: 'Secret names', skills: 'Skills',
}

export let groupName = (group: string) => labels[group] ?? group
export let colorOf = (node: Node) =>
  sections.find((s) => s.groups.includes(node.group))?.color ?? 'info'

export let statusOf = (node: Node) => node.group == 'phases' ? 'pipeline label'
  : node.bound ? 'bound'
  : node.loaded ? 'loaded'
  : node.group == 'facets' && node.detail.attempted === false ? 'unattempted'
  : node.declared ? 'declared' : 'not declared'

export let filtered = (model: AtlasModel) => {
  let { filter, group } = model.state
  let text = filter.trim().toLocaleLowerCase()
  return model.nodes.filter((node) =>
    (!group || group == 'all' || node.group == group) &&
    (!text || [node.name, node.package, node.facet, node.description]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(text))
  ).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

// Phase labels belong to the spine (and list), never the composition map.
export let mapParts = (model: AtlasModel) =>
  filtered(model).filter((node) => node.group != 'phases')

export let elapsed = (event?: Activity) => event?.duration == undefined
  ? event?.stage == 'start' ? 'in flight' : '—'
  : `${event.duration < 1 ? event.duration.toFixed(2)
    : event.duration.toFixed(1)} ms`

let phaseOf = (event: Activity, node: Node) => event.kind == 'phase' &&
  (event.node == node.id || event.name == node.detail.phase ||
    event.name.split('.').at(-1) == node.detail.phase)

/** The model supplies explanatory pipeline labels, not bound host handlers.
 * Only retained phase observations supply timing and pulses. */
export let Spine = ({ model }: { model: AtlasModel }) => {
  let recent = model.events.slice(-PULSE_LIMIT)
  let phases = model.nodes.filter((node) => node.group == 'phases')
    .sort((a, b) => Number(a.detail.order ?? 0) - Number(b.detail.order ?? 0))
  return <section class="Spine" aria-label="Pipeline labels and observed phase activity">
    <div class="Spine_Intro">
      <span class="Atlas_Eyebrow">Pipeline labels</span>
      <strong>apply()</strong>
      <span>Labels ≠ bound handlers. Activity is observed.</span>
    </div>
    {phases.length ? <ol class="Spine_Path">
      {phases.map((node, i) => {
        let event = recent.findLast((e) => phaseOf(e, node))
        return <li key={node.id} class="Spine_Step"
          data-observed={Boolean(event)} data-path={node.detail.path}>
          <button type="button" class="Spine_Phase"
            onClick={() => {
              model.select(node.id)
              if (event) model.choose(event.id)
            }}
            title={event ? `${event.name}: ${elapsed(event)}`
              : `${node.name}: no observation in the last ${PULSE_LIMIT} records`}>
            <span class="Spine_Number">{String(i + 1).padStart(2, '0')}</span>
            <span>{node.name}</span>
            {node.detail.path == 'rollback' &&
              <span class="Spine_PathLabel">rollback only</span>}
            <span class="Spine_Time">{elapsed(event)}</span>
            {event && <span key={`${event.epoch}:${event.seq}`}
              class="Spine_Pulse" />}
          </button>
        </li>
      })}
    </ol> : <p class="Spine_Empty">Pipeline labels are not available in this page.</p>}
  </section>
}

type Placed = { node: Node; x: number; y: number }
type Frame = typeof sections[number] & {
  x: number; y: number; height: number; total: number; shown: Placed[]
}

// Round-robin allocation prevents a large vocabulary from hiding every other
// mechanism. Position depends only on filtered anatomy, never on event rates.
let geometry = (nodes: Node[]) => {
  let buckets = sections.map((section) => ({
    ...section,
    nodes: nodes.filter((n) => section.groups.includes(n.group)),
    take: [] as Node[],
  }))
  let count = 0
  while (count < NODE_LIMIT) {
    let moved = false
    for (let b of buckets) {
      if (count >= NODE_LIMIT) break
      if (b.take.length >= b.nodes.length) continue
      b.take.push(b.nodes[b.take.length])
      count++
      moved = true
    }
    if (!moved) break
  }
  let top = Math.max(304, ...buckets.slice(0, 3)
    .map((b) => 104 + Math.ceil(b.take.length / 2) * 46))
  let frames: Frame[] = buckets.map((b, i) => {
    let x = 24 + (i % 3) * 462
    let y = i < 3 ? 24 : top + 48
    let height = Math.max(304, 104 + Math.ceil(b.take.length / 2) * 46)
    return {
      ...b, x, y, height, total: b.nodes.length,
      shown: b.take.map((node, j) => ({
        node, x: x + 18 + (j % 2) * 211,
        y: y + 84 + Math.floor(j / 2) * 46,
      })),
    }
  })
  let placed = frames.flatMap((f) => f.shown)
  return { frames, placed, height: Math.max(...frames.map((f) =>
    f.y + f.height)) + 24, width: 1428 }
}

let pathOf = (a: Placed, b: Placed) => {
  let ax = a.x + 101, ay = a.y + 18
  let bx = b.x + 101, by = b.y + 18
  let mid = (ax + bx) / 2
  return `M${ax},${ay} C${mid},${ay} ${mid},${by} ${bx},${by}`
}

let short = (name: string, length = 25) => name.length > length
  ? `${name.slice(0, length - 1)}…` : name

export let zoomed = (model: AtlasModel, delta: number) =>
  model.set({ zoom: Math.min(3, Math.max(.35, model.state.zoom + delta)) })

type Drag = {
  id: number; x: number; y: number; cameraX: number; cameraY: number
  ratio: number
}

/** The map has no clocks or animation loop. At most 48 observed records pulse. */
export let Topology = ({ model }: { model: AtlasModel }) => {
  let state = model.state
  let nodes = mapParts(model)
  let { frames, placed, height, width } = geometry(nodes)
  let positions = new Map(placed.map((p) => [p.node.id, p]))
  let relations = model.edges.filter((e) =>
    positions.has(e.from) && positions.has(e.to))
  let edges = relations.slice(0, EDGE_LIMIT)
  let related = new Set(model.edges.filter((e) =>
    e.from == state.selected || e.to == state.selected)
    .flatMap((e) => [e.from, e.to]))
  let active = model.events.slice(-PULSE_LIMIT).filter((e) =>
    e.kind != 'phase' && e.node && positions.has(e.node))
  let drag = useRef<Drag | undefined>()
  let pan = (event: PointerEvent) => {
    if (event.button != 0 ||
      (event.target as Element).closest('[data-node],[data-edge]')) return
    let svg = event.currentTarget as SVGSVGElement
    let rect = svg.getBoundingClientRect()
    drag.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      cameraX: state.x, cameraY: state.y,
      ratio: Math.max(width / rect.width, height / rect.height) / state.zoom,
    }
    svg.setPointerCapture(event.pointerId)
  }
  let move = (event: PointerEvent) => {
    let start = drag.current
    if (!start || start.id != event.pointerId) return
    model.set({
      x: start.cameraX + (event.clientX - start.x) * start.ratio,
      y: start.cameraY + (event.clientY - start.y) * start.ratio,
    })
  }
  let end = (event: PointerEvent) => {
    if (drag.current?.id == event.pointerId) drag.current = undefined
  }
  let press = (event: KeyboardEvent, id: string) => {
    if (event.key == 'Enter' || event.key == ' ') {
      event.preventDefault()
      model.select(id)
    }
  }
  let pickEdge = (edge: Edge) => model.select(edge.id)
  return <section class="Map" aria-label="System anatomy map">
    <header class="Map_Header">
      <div>
        <span class="Atlas_Eyebrow">Anatomy</span>
        <h2>The shape of this runtime</h2>
      </div>
      <span class="Map_Count">{placed.length} of {nodes.length} parts
        <span> · {edges.length} relations</span>
      </span>
    </header>
    {!nodes.length && <div class="Map_NoMatches" role="status">
      <strong>No parts match this view.</strong>
      <span>Change the filter or choose another anatomy group.</span>
    </div>}
    <div class="Map_Viewport">
      <svg class="Map_Canvas" viewBox={`0 0 ${width} ${height}`}
        role="group" aria-label="Pan and zoom the system topology"
        tabIndex={0} onPointerDown={pan} onPointerMove={move}
        onPointerUp={end} onPointerCancel={end}
        onLostPointerCapture={() => { drag.current = undefined }}>
        <defs>
          <pattern id="atlas-grid" width="24" height="24"
            patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".7" class="Map_GridDot" />
          </pattern>
          <marker id="atlas-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" class="Map_Arrow" />
          </marker>
        </defs>
        <rect width={width} height={height} fill="url(#atlas-grid)" />
        <g transform={`translate(${width / 2} ${height / 2}) ` +
          `scale(${state.zoom}) ` +
          `translate(${-width / 2 + state.x} ${-height / 2 + state.y})`}>
          {frames.map((f) => <g key={f.id} class="Map_Lane"
            style={{ '--lane': `var(--${f.color})` }}>
            <rect x={f.x} y={f.y} width="438" height={f.height} rx="16"
              class="Map_Frame" />
            <text x={f.x + 18} y={f.y + 28} class="Map_LaneMark">{f.mark}</text>
            <text x={f.x + 54} y={f.y + 29} class="Map_LaneName">{f.name}</text>
            <text x={f.x + 18} y={f.y + 54} class="Map_LaneNote">{f.note}</text>
            <text x={f.x + 414} y={f.y + 29} text-anchor="end"
              class="Map_LaneCount">{f.shown.length}/{f.total}</text>
            {!f.total && <text x={f.x + 18} y={f.y + 112}
              class="Map_EmptyLane">{f.groups.some((group) =>
                model.coverage[group] === false)
                ? 'Includes unobserved categories' : 'No matching declarations'}</text>}
          </g>)}
          <g class="Map_Relations">
            {edges.map((edge) => {
              let from = positions.get(edge.from)!
              let to = positions.get(edge.to)!
              let selected = state.selected == edge.id ||
                state.selected == edge.from || state.selected == edge.to
              return <g key={edge.id} data-edge={edge.id}
                class={`Map_Edge${selected ? ' Map_Edge-selected' : ''}`}
                role="button" tabIndex={0} aria-pressed={state.selected == edge.id}
                aria-label={`${from.node.name} ${edge.kind} ${to.node.name}`}
                onClick={() => pickEdge(edge)}
                onKeyDown={(event) => press(event, edge.id)}>
                <title>{from.node.name} → {edge.kind} → {to.node.name}</title>
                <path d={pathOf(from, to)} class="Map_EdgeHit" />
                <path d={pathOf(from, to)} class="Map_EdgeLine"
                  marker-end="url(#atlas-arrow)" />
              </g>
            })}
          </g>
          {placed.map(({ node, x, y }) => <g key={node.id}
            transform={`translate(${x} ${y})`} data-node={node.id}
            style={{ '--node': `var(--${colorOf(node)})` }}
            class={`Map_Node${state.selected == node.id
              ? ' Map_Node-selected' : related.has(node.id)
              ? ' Map_Node-related' : ''}`}
            role="button" tabIndex={0} aria-pressed={state.selected == node.id}
            aria-label={`${node.name}, ${groupName(node.group)}, ${statusOf(node)}`}
            onClick={() => model.select(node.id)}
            onKeyDown={(event) => press(event, node.id)}>
            <title>{node.name} · {groupName(node.group)} · {statusOf(node)}</title>
            <rect width="202" height="37" rx="7" class="Map_NodeBody" />
            <circle cx="13" cy="18" r="3" class="Map_NodeDot"
              data-bound={node.bound} data-loaded={node.loaded} />
            <text x="25" y="16" class="Map_NodeName">{short(node.name)}</text>
            <text x="25" y="29" class="Map_NodeKind">
              {groupName(node.group)} · {statusOf(node)}
            </text>
          </g>)}
          {active.map((event) => {
            let p = positions.get(event.node!)!
            return <rect key={`${event.epoch}:${event.seq}`} x={p.x - 3}
              y={p.y - 3} width="208" height="43" rx="9"
              class="Map_Pulse" pointer-events="none"
              style={{ '--node': `var(--${colorOf(p.node)})` }} />
          })}
        </g>
      </svg>
      <div class="Map_Camera" aria-label="Map camera controls">
        <Button type="button" aria-label="Zoom out"
          onClick={() => zoomed(model, -.2)}>−</Button>
        <output aria-label="Current zoom">{Math.round(state.zoom * 100)}%</output>
        <Button type="button" aria-label="Zoom in"
          onClick={() => zoomed(model, .2)}>+</Button>
        <Button type="button" onClick={() =>
          model.set({ x: 0, y: 0, zoom: 1 })}>Fit</Button>
      </div>
      <div class="Map_Legend" aria-label="Map legend">
        <span><i class="Map_LegendDot Map_LegendDot-bound" />bound</span>
        <span><i class="Map_LegendDot" />declaration</span>
        <span><i class="Map_LegendLine" />relationship</span>
      </div>
    </div>
    <footer class="Map_Footer">
      <span>Drag to pan · + / − zoom · ↑ / ↓ select · Enter inspect</span>
      <span class="Map_Budget">≤{PULSE_LIMIT} observed records animate</span>
      {(nodes.length > NODE_LIMIT || relations.length > EDGE_LIMIT) && <Button
        type="button" mod="quiet" onClick={() => model.set({ view: 'list' })}>
        Map cap: {NODE_LIMIT} parts / {EDGE_LIMIT} relations. Open full list →
      </Button>}
    </footer>
  </section>
}
