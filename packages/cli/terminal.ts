// Terminal presentation of portable answers. Only the CLI loads the painter
// and the process-backed interactive runner.
import type { Bundle } from '@yaks/graph'
import { prepared, type Registry, type Renderer, resolve } from '@yaks/render'
import type { Vocab } from '@yaks/vocab/runtime'
import type { ComponentChild } from 'preact'
import type { Sheet } from '@yaks/tui/theme'
import { sheet } from '@yaks/render/views'
import {
  type Drawn,
  drawn,
  freshness,
  type Held,
  joined,
  type Near,
  nearOf,
  nearQuery,
  NONE,
  nothing,
  parted,
  printed,
  referenced,
  type Source,
  standing,
  type Tty,
  viewOf,
} from './answer.ts'

// What an answer wears in a terminal: @yaks/ui's components and these views'
// own classes, in its default theme. Loaded with the painter, so a printed
// answer never pays for it.
let dressed = async (): Promise<Sheet> => {
  let { composition, sheet: kit } = await import('@yaks/ui')
  return { ...kit(composition), ...sheet(composition.theme.colors) }
}

/** The same answer painted for a terminal `columns` wide: the same views,
 * mounted in @yaks/tui's document and laid out, styled and colored by its
 * painter, once. Loaded only for a terminal, so a printed answer never pays
 * for the painter. */
export let painted = async (
  views: Held,
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[],
  columns: number,
  page?: Near,
  answers?: ReadonlyMap<string, Bundle[]>,
): Promise<string> => {
  let [{ render: mount }, { print }, dress] = await Promise.all([
    import('@yaks/preact'),
    import('@yaks/tui/print'),
    dressed(),
  ])
  let groups = drawn<ComponentChild>(
    vocab,
    answer,
    named,
    page,
    (b, v, c) => mount(views, b, v, vocab, { ...c, readOnly: true }),
    { answers },
  )
  return joined([
    ...groups.map((g) => g.map((n) => print(n, columns, dress))),
    [freshness(answer, page)],
  ])
}

/** An answer held in the terminal (@yaks/tui) until Ctrl-C, drawn as a
 * printout draws it ({@link painted}). Loaded only when asked for, so a
 * printed answer never pays for a terminal app. `config` is the config file
 * naming the graph the answer came from, for a view that keeps reading it. A
 * lone answer whose page is a component of its own (a plugin's `./tui`) is an
 * app, and has the whole terminal, whether or not the answer was drawn as a
 * `page`; anything else scrolls. */
export let hold = async (
  views: Held,
  vocab: Vocab,
  answer: Bundle[],
  config?: string,
  named: Bundle[] = [],
  page?: Near,
  answers?: ReadonlyMap<string, Bundle[]>,
): Promise<void> => {
  let [{ h }, { render: mount }, { run, Scroll }, dress] = await Promise.all([
    import('preact'),
    import('@yaks/preact'),
    import('@yaks/tui'),
    dressed(),
  ])
  let [lone] = answer
  let app = answer.length == 1 && 'Render' in
      (resolve(views, lone, 'Page', vocab, { config }) ?? {})
  await run(() => {
    let nodes = drawn<ComponentChild>(
      vocab,
      answer,
      named,
      app ? page ?? nothing : page,
      (b, v, c) => mount(views, b, v, vocab, { ...c, config }),
      { answers },
    ).flat()
    return app ? nodes[0] : h(
      Scroll,
      { id: 'answer', grow: '1' },
      nodes.map((n) => h('div', null, n)),
    )
  }, { sheet: dress })
}

let none: Source = { lookup: () => [], query: () => [] }

/** An answer shown the way the command asked — held in the terminal under
 * `--tui`, drawn by `held` where the command has terminal views and a config
 * to read (answer.ts `terminal`), painted where stdout is a terminal, and printed
 * otherwise — and the way its `tool` was declared ({@link Drawn}): the answer
 * of one that wrote is drawn {@link standing}, and a page tool's lone entity
 * whole, beside the links and comments its page asks for. */
export let show = async (
  c: { tui: boolean; tty?: Tty; out: (line: string) => void },
  views: Registry,
  vocab: Vocab,
  said: Bundle[],
  held: { views?: Held; config?: string } = {},
  from: Source = none,
  tool: Drawn = { readOnly: true },
): Promise<void> => {
  let answer = tool.readOnly ? said : await standing(said, from)
  // A read that found nothing says so: a blank answer reads as a command
  // that did nothing, or one still working.
  if (tool.readOnly && !answer.length && !c.tui) {
    return c.tty ? c.tty.write(NONE) : c.out(NONE)
  }
  let them = parted(answer).them
  let lone = viewOf(them, !!tool.page) == 'Page' ? them[0] : undefined
  let asked = lone ? nearQuery(vocab, lone.entity.eid) : null
  let page = !lone
    ? undefined
    : asked
    ? nearOf(lone.entity.eid, await from.query(asked))
    : nothing
  let near = page ?? nothing
  // Portable renderers are pure. Discover the references and queries the
  // drawing reads, including nested views and declared needs, rather than
  // fetching every reference carried by a bundle that a tile never shows. A
  // terminal paints with what the printout read, and the references its
  // components may read beside it.
  let known = new Set(
    [...answer, ...near.links, ...near.comments].map((b) => b.entity.eid),
  )
  let painting = c.tui || c.tty
  let refs = painting
    ? referenced(
      vocab,
      [...answer, ...near.links, ...near.comments],
      held.views ?? views,
      lone?.entity.eid,
    )
    : []
  let named: Bundle[] = refs.length ? await from.lookup(refs) : []
  named.forEach((b) => known.add(b.entity.eid))
  let answers = new Map<string, Bundle[]>()
  let text = ''
  while (true) {
    let pending = new Set<string>()
    let asking = new Set<string>()
    let loading = new Set<Renderer>()
    try {
      text = printed(views, vocab, answer, named, page, {
        answers,
        eid: (eid) => eid && !known.has(eid) && pending.add(eid),
        query: (q) => asking.add(q),
        deferred: (r) => loading.add(r),
      })
    } catch (error) {
      // A drawing may require a declared or newly-read dependency before
      // it can finish. Retry after those reads; failures without new reads
      // remain drawing errors, including required references that are gone.
      if (!pending.size && !loading.size && !asking.size) throw error
    }
    if (!pending.size && !loading.size && !asking.size) break
    let ids = [...pending]
    ids.forEach((id) => known.add(id))
    let [ready, found, said] = await Promise.all([
      loading.size ? prepared(views, [...loading]) : views,
      ids.length ? from.lookup(ids) : [],
      Promise.all(
        [...asking].map(async (q) =>
          [q, await Promise.resolve(from.query(q)).catch(() => [])] as const
        ),
      ),
    ])
    views = ready
    named.push(...found)
    found.forEach((b) => known.add(b.entity.eid))
    said.forEach(([q, rows]) => answers.set(q, rows))
  }
  if (!painting) {
    if (text) c.out(text)
    return
  }
  if (c.tui) {
    return await hold(
      held.views ?? views,
      vocab,
      answer,
      held.config,
      named,
      page,
      answers,
    )
  }
  if (c.tty) {
    let text = await painted(
      held.views ?? views,
      vocab,
      answer,
      named,
      c.tty.columns,
      page,
      answers,
    )
    if (text) c.tty.write(text)
    return
  }
}
