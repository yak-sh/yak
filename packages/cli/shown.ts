// What a command line shows: an answer drawn with its config's plugin views
// (terminal.ts `show`). Apart from terminal.ts, which a browser page loads
// too, because finding a plugin's views reads the disk (./config.ts).

import type { Bundle } from '@yaks/graph'
import type { Registry } from '@yaks/render'
import type { Vocab } from '@yaks/vocab/runtime'
import type { AnatomyObserver } from '@yaks/code/anatomy'
import { type Drawn, type Source, terminal, type Tty } from './answer.ts'
import { pluginTui, pluginViews } from './config.ts'
import { show } from './terminal.ts'

/** An answer drawn as a command line shows one, with the views of `plugins`
 * ({@link show}): held or painted in their terminal components where `c`
 * holds or paints, printed otherwise. `from` is where the drawing reads what
 * it needs beside the answer. */
export let shown = async (
  c: {
    tui: boolean
    tty?: Tty
    out: (line: string) => void
    config?: string
  },
  plugins: string[],
  views: Registry,
  vocab: Vocab,
  said: Bundle[],
  from: Source,
  tool: Drawn,
  observe?: AnatomyObserver,
): Promise<void> =>
  show(
    c,
    views,
    vocab,
    said,
    c.tui || c.tty
      ? {
        views: await terminal(plugins, pluginViews, pluginTui, observe),
        config: c.config,
      }
      : {},
    from,
    tool,
  )
