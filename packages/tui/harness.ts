import { clip } from './paint.ts'
import { routeMouse } from './mouse.ts'
/**
 * A mounted app for a test: a fake terminal of a fixed size, the ANSI backend
 * writing into an array instead of a tty, and keys delivered the way the real
 * loop delivers them — raw bytes through `decode` into the focus stack. `send`
 * answers with the number of screen lines that keystroke cost, which is what
 * makes "snappy" an assertion rather than a hope.
 *
 * @module
 */

import { type ComponentType, h, render } from 'preact'
import { install, onPaint } from './dom.ts'
import { decode } from './input.ts'
import { ansiBackend, screenful } from './paint.ts'
import { clear, measured, press, size } from './screen.ts'

/** Mount an app on a fake terminal; `free()` restores the document. */
export let mount = async (
  App: ComponentType,
  columns = 60,
  rows = 12,
): Promise<{
  out: string[]
  text: () => string
  send: (bytes: string) => Promise<number>
  resize: (width: number, height: number) => Promise<void>
  free: () => void
}> => {
  let screen = install()
  let out: string[] = []
  let wrote = 0
  let backend = ansiBackend({
    size: () => ({ columns, rows }),
    write: (s) => void out.push(s),
  })
  size.value = { columns, rows }
  onPaint(() => {
    let r = backend.draw(screen.root)
    wrote += r.written
    measured(r.metrics)
  })
  render(h(App, {}), screen.root as unknown as Parameters<typeof render>[1])
  // Preact renders and the tree repaints on microtasks; a few turns settle the
  // measure/re-render loop a scroll region makes on its first paint.
  let settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }
  await settle()
  return {
    out,
    text: () =>
      screenful(screen.root, columns, rows).lines
        .map((l) => l.map((s) => s.text).join('').trimEnd())
        .join('\n'),
    send: async (bytes: string) => {
      wrote = 0
      for (let key of decode(bytes)) {
        if (key.name == 'mouse') {
          routeMouse(
            key,
            screenful(screen.root, columns, rows).lines.slice(0, rows).map(
              (line) => clip(line, columns),
            ),
          )
        } else press(key)
      }
      await settle()
      return wrote
    },
    resize: async (width, height) => {
      columns = width
      rows = height
      size.value = { columns, rows }
      measured(backend.draw(screen.root).metrics)
      await settle()
    },
    free: () => {
      render(null, screen.root as unknown as Parameters<typeof render>[1])
      onPaint(() => {})
      clear()
      screen.free()
    },
  }
}
