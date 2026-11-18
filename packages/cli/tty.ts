// Process-backed presentation of the portable answers prepared by terminal.ts.
import type { Bundle } from '@yaks/graph'
import { resolve } from '@yaks/render'
import type { Vocab } from '@yaks/vocab/runtime'
import type { ComponentChild } from 'preact'
import type { Sheet } from '@yaks/tui/theme'
import { sheet } from '@yaks/render/views'
import {
  drawn,
  freshness,
  type Held,
  joined,
  type Near,
  nothing,
} from './answer.ts'
import { show as present } from './terminal.ts'

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

/** Prepare and present an answer with the process-backed terminal painter. */
export let show = async (
  ...args: Parameters<typeof present>
): Promise<void> => {
  let [c, views, vocab, said, held = {}, from, tool] = args
  return await present(
    c,
    views,
    vocab,
    said,
    held,
    from,
    tool,
    c.tui || c.tty
      ? async (prepared, answer, named, page, answers) => {
        if (c.tui) {
          return await hold(
            held.views ?? prepared,
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
            held.views ?? prepared,
            vocab,
            answer,
            named,
            c.tty.columns,
            page,
            answers,
          )
          if (text) c.tty.write(text)
        }
      }
      : undefined,
  )
}
