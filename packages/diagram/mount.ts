// A drawing kept in step with a graph: it reads its query, lays the answer out
// over the last layout and puts the SVG into an element, again after every
// commit. The graph's own `effect` phase is the signal, so a write through any
// door redraws it.
import { human } from '@yaks/id'
import type { Bundle, Graph } from '@yaks/graph'
import { type Layout, layout, type Options } from './layout.ts'
import { svg, type SvgOptions } from './svg.ts'

/** What a drawing is drawn into: an element's markup. */
export type Sheet = { innerHTML: string }

/** What a mounted drawing draws, and how. */
export type MountOptions = SvgOptions & Pick<Options, 'at' | 'shapes'> & {
  graph: Graph
  /** What is drawn. */
  query: string
  width?: number
  height?: number
  /** The stage a commit belongs to, asked as it commits: what it adds is
   * stamped with it (default 0). */
  stage?: () => number
  /** Told each layout once it is drawn. */
  drawn?: (layout: Layout) => void
  /** Told when a redraw after a commit fails (default: reportError). */
  failed?: (err: unknown) => void
}

/** A mounted drawing. */
export type Mounted = {
  /** Draw another query's answer. What this drawing has drawn before, under
   * any query, keeps its place, order and stage; what it adds is stamped
   * with `stage` (default: `MountOptions.stage`).
   * Settles once drawn, and refuses as the graph refuses the query; the old
   * drawing stays then. */
  query: (query: string, stage?: number) => Promise<Layout>
  /** Read and draw again. */
  redraw: () => Promise<Layout>
  /** The layout last drawn. */
  readonly layout: Layout | undefined
  /** Stop following the graph. */
  stop: () => void
}

// A layout of everything in `seen` and `drawn`, as `drawn` has it.
let remember = (seen: Layout | undefined, drawn: Layout): Layout => {
  let by = <T>(old: T[] = [], now: T[], key: (x: T) => string) => [
    ...new Map([...old, ...now].map((x) => [key(x), x])).values(),
  ]
  return {
    ...drawn,
    nodes: by(seen?.nodes, drawn.nodes, (n) => n.eid),
    links: by(seen?.links, drawn.links, (l) => l.key),
  }
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
  let { graph, width, height, drawn, at, shapes } = opts
  let failed = opts.failed ?? ((err: unknown) => globalThis.reportError(err))
  let label = human(graph.vocab)
  let current = opts.query
  let last: Layout | undefined
  // Everything drawn so far, under any query, as it was last drawn: what
  // comes back after another query has been shown keeps its stage.
  let seen: Layout | undefined
  let running: Promise<Layout> | undefined
  let again = false
  // The stage of the first commit not yet read.
  let stage: number | undefined
  let take = () => {
    let s = stage ?? opts.stage?.() ?? 0
    stage = undefined
    return s
  }
  let draw = (bundles: Bundle[], s: number) => {
    last = layout(bundles, {
      was: seen,
      width,
      height,
      label,
      at,
      shapes,
      stage: s,
    })
    seen = remember(seen, last)
    sheet.innerHTML = svg(last, opts)
    drawn?.(last)
    return last
  }
  let read = (query: string, s: number) =>
    Promise.resolve(graph.read(query)).then((bundles) => draw(bundles, s))
  let redraw = (): Promise<Layout> => {
    if (running) return (again = true, running)
    running = read(current, take()).finally(() => {
      running = undefined
      if (again) (again = false, redraw().catch(failed))
    })
    return running
  }
  let stop = follow(graph, () => {
    stage ??= opts.stage?.()
    redraw().catch(failed)
  })
  redraw().catch(failed)
  return {
    query: (query, stage) =>
      Promise.resolve(graph.read(query)).then((bundles) => {
        current = query
        return draw(bundles, stage ?? opts.stage?.() ?? 0)
      }),
    redraw,
    get layout() {
      return last
    },
    stop: () => void stop(),
  }
}
