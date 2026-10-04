/** Isolated session-switch benchmark. No default database is opened. */
import { remote } from './remote.ts'
import type { Bundle } from '@yaks/graph'
import { h as node } from 'preact'
import { App } from './app.ts'
import { frontend } from './frontend.ts'
import { at, harness, mount } from './testing.ts'
import type { Samples } from '@yaks/benchmark'
import { standaloneMain } from '../../bench/standalone.ts'

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let directory = await Deno.makeTempDir()
  let count = Number(args[0] ?? 100)
  let depth = Number(args[1] ?? 1000)
  let h = await harness(directory + '/test.db')
  try {
    for (let i = 0; i < count; i++) {
      let bundles: Bundle[] = [{
        entity: { eid: 's' + i },
        session: { id: 's' + i },
      }]
      let length = i < 2 ? depth : 10
      for (let j = 0; j < length; j++) {
        bundles.push({
          entity: { eid: 'e' + i + '-' + j },
          entry: { session: 's' + i, seq: j + 1 },
          content: {
            body: (j ? 'body ' : 'title ') + i + ' ' + 'x'.repeat(1000),
          },
          ...(j ? { output: { source: 'e' + i + '-0' } } : {}),
        })
      }
      await h.g.apply(bundles)
    }
  } finally {
    h.close()
  }
  let r = await remote({
    config: at(directory + '/test.db'),
    cwd: directory,
    fake: true,
  })
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
    return {
      switch: samples.map(({ total }) => ({
        value: total,
        source: 'paint',
        counts: { sessions: count, depth },
      })),
      'timer-delay': { value: Math.max(0, delay), details: r.traffic },
    }
  } finally {
    clearInterval(timer)
    screen.free()
    ui.close()
    await r.close()
    await Deno.remove(directory, { recursive: true })
  }
}

if (import.meta.main) await standaloneMain('harness-switch')
