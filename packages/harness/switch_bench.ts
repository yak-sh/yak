/** Isolated session-switch benchmark. No default database is opened. */
import { open } from './store.ts'
import { remote } from './remote.ts'
import type { Bundle } from '@yaks/graph'
import { h as node } from 'preact'
import { mount } from '../tui/harness.ts'
import { App } from './app.ts'
import { frontend } from './frontend.ts'

let directory = await Deno.makeTempDir()
let count = Number(Deno.args[0] ?? 100)
let depth = Number(Deno.args[1] ?? 1000)
let h = open(directory + '/test.db')
try {
  for (let i = 0; i < count; i++) {
    let changes: Bundle[] = [{
      entity: { eid: 's' + i },
      session: { id: 's' + i },
    }]
    let length = i < 2 ? depth : 10
    for (let j = 0; j < length; j++) {
      changes.push({
        entity: { eid: 'e' + i + '-' + j },
        entry: { session: 's' + i, seq: j + 1 },
        content: {
          body: (j ? 'body ' : 'title ') + i + ' ' + 'x'.repeat(1000),
          ...(j ? { source: 'e' + i + '-0' } : {}),
        },
      })
    }
    await h.g.apply(changes)
  }
} finally {
  h.close()
}
let r = await remote({ db: directory + '/test.db', cwd: directory, fake: true })
let samples: Record<string, number>[] = []
let ui = frontend()
let screen = await mount(
  () => node(App, { agent: r.agent, subscribe: r.subscribe, frontend: ui }),
  120,
  32,
)
let timerLast = performance.now(), delay = 0
let timer = setInterval(() => {
  let now = performance.now()
  delay = Math.max(delay, now - timerLast - 2)
  timerLast = now
}, 2)
try {
  // Match the user path: select in the UI graph, wait for the requested
  // transcript to reach the painter. Sidebar text alone cannot satisfy this.
  for (let i = 0; i < 12; i++) {
    let which = i % 2
    let start = performance.now()
    ui.patch({ selected: 's' + which, generation: i + 1 })
    while (!screen.text().includes('body ' + which + ' ')) {
      if (performance.now() - start > 30000) {
        throw new Error('Switch never painted')
      }
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    samples.push({ total: performance.now() - start })
  }
  console.log(
    JSON.stringify(
      { count, depth, samples, maxTimerDelayMs: delay, traffic: r.traffic },
      null,
      2,
    ),
  )
} finally {
  clearInterval(timer)
  screen.free()
  ui.close()
  await r.close()
  await Deno.remove(directory, { recursive: true })
}
