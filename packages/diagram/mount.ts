// A drawing kept in step with a graph: it reads its query, lays the answer out
// over the last layout and puts the SVG into an element, again after every
// commit. The graph's own `effect` phase is the signal, so a write through any
// door redraws it.
import { human } from '@yaks/id'
import type { Bundle, Graph } from '@yaks/graph'
import { type Layout, layout } from './layout.ts'
import { svg, type SvgOptions } from './svg.ts'

/** What a drawing is drawn into: an element's markup. */
export type Sheet = { innerHTML: string }

/** What a mounted drawing draws, and how. */
export type MountOptions = SvgOptions & {
  graph: Graph
  /** What is drawn. */
  query: string
  width?: number
  height?: number
  /** Told each layout once it is drawn. */
  drawn?: (layout: Layout) => void
  /** Told when a redraw after a commit fails (default: reportError). */
  failed?: (err: unknown) => void
}

/** A mounted drawing. */
export type Mounted = {
  /** Draw another query's answer, keeping the places of what both select.
   * Settles once drawn, and refuses as the graph refuses the query; the old
   * drawing stays then. */
  query: (query: string) => Promise<Layout>
  /** Read and draw again. */
  redraw: () => Promise<Layout>
  /** The layout last drawn. */
  readonly layout: Layout | undefined
  /** Stop following the graph. */
  stop: () => void
}

// One effect hook per graph, telling every drawing mounted on it.
let told = new WeakMap<Graph, Set<() => void>>()
let follow = (graph: Graph, fn: () => void) => {
  let fns = told.get(graph)
  if (!fns) {
    told.set(graph, fns = new Set())
    let all = fns
    graph.use({
      name: 'diagram',
      hooks: { effect: (bundles) => (all.forEach((f) => f()), bundles) },
    })
  }
  fns.add(fn)
  return () => fns.delete(fn)
}

/**
 * Keep `sheet` drawing what `query` selects in `graph`. Commits that land
 * while a read is under way are drawn by one more read, not one each.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { mount } from '@yaks/diagram'
 * import { assert } from '@std/assert'
 *
 * let vocab = loadVocab({ $defs: { doc: { component: true, properties: { title: { type: 'string' } } } } })
 * let g = graph({ vocab, storage: ram(vocab) })
 * let sheet = { innerHTML: '' }
 * let drawing = mount(sheet, { graph: g, query: '.doc' })
 * await g.apply([{ entity: { eid: crypto.randomUUID() }, doc: { title: 'Dune' } }])
 * await drawing.redraw()
 * assert(sheet.innerHTML.includes('Dune'))
 * drawing.stop()
 * ```
 */
export let mount = (sheet: Sheet, opts: MountOptions): Mounted => {
  let { graph, width, height, drawn } = opts
  let failed = opts.failed ?? ((err: unknown) => globalThis.reportError(err))
  let label = human(graph.vocab)
  let current = opts.query
  let last: Layout | undefined
  let running: Promise<Layout> | undefined
  let again = false
  let draw = (bundles: Bundle[]) => {
    last = layout(bundles, { was: last, width, height, label })
    sheet.innerHTML = svg(last, opts)
    drawn?.(last)
    return last
  }
  let read = (query: string) => Promise.resolve(graph.read(query)).then(draw)
  let redraw = (): Promise<Layout> => {
    if (running) return (again = true, running)
    running = read(current).finally(() => {
      running = undefined
      if (again) (again = false, redraw().catch(failed))
    })
    return running
  }
  let stop = follow(graph, () => void redraw().catch(failed))
  redraw().catch(failed)
  return {
    query: (query) =>
      Promise.resolve(graph.read(query)).then((bundles) => {
        current = query
        return draw(bundles)
      }),
    redraw,
    get layout() {
      return last
    },
    stop: () => void stop(),
  }
}
