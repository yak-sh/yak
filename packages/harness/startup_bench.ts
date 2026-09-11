/** Isolated startup benchmark. Does not open the configured harness database. */
import { open } from './store.ts'
import { agent } from './run.ts'
import { remote } from './remote.ts'
import type { Bundle } from '@yaks/graph'
import { h as node } from 'preact'
import { mount } from '../tui/harness.ts'
import { App } from './app.ts'
import { frontend } from './frontend.ts'

let directory = await Deno.makeTempDir({ prefix: 'harness-startup-' })
let count = Number(Deno.args[0] ?? 300)
let depth = Number(Deno.args[1] ?? 4000)
let path = directory + '/bench.db'
let seed = open(path)
try {
  for (let i = 0; i < count; i++) {
    let rows: Bundle[] = [{
      entity: { eid: 's' + i },
      session: { id: 's' + i },
    }]
    if (i) {
      rows[0].spawned = { parent: 's0' }
      rows[0].fork = { from: 's0-e' + (depth - 1) }
    }
    let n = i ? 10 : depth
    for (let j = 0; j < n; j++) {
      rows.push({
        entity: { eid: 's' + i + '-e' + j },
        entry: { session: 's' + i },
        content: {
          body: 'message ' + 'x'.repeat(1000),
          ...(j ? { source: 's' + i + '-e0' } : {}),
        },
      })
    }
    await seed.g.apply(rows)
    if (i) {
      await seed.g.apply([{
        entity: { eid: 'delivery:s' + i + ':s' + i + '-e9' },
        entry: { session: 's0' },
        content: { body: 'delivered', source: 's0-e0' },
      }])
    }
  }
} finally {
  seed.close()
}
try {
  for (let run = 0; run < 3; run++) {
    let times: Record<string, number> = {}
    let last = performance.now()
    let mark = (name: string) => {
      let now = performance.now()
      times[name] = Math.round(now - last)
      last = now
    }
    let h = open(path)
    mark('open')
    let a = agent({
      h,
      model: () => Promise.resolve({ id: 'fake', model: 'fake', items: [] }),
      name: 'fake',
      cwd: directory,
    })
    mark('agent')
    await a.sessions()
    mark('sessions')
    await a.transcript('s0')
    mark('transcriptRead')
    await a.close()
    mark('close')
    let r = await remote({ db: path, cwd: directory, fake: true })
    mark('remoteReady')
    await r.resume()
    mark('resume')
    await r.agent.sessions()
    mark('remoteSessions')
    await r.agent.transcript('s0')
    mark('remoteTranscript')
    let ui = frontend()
    ui.patch({ selected: 's0' })
    let screen = await mount(
      () =>
        node(App, {
          agent: r.agent,
          subscribe: r.subscribe,
          frontend: ui,
        }),
      120,
      32,
    )
    mark('mount')
    let begin = performance.now()
    try {
      while (!screen.text().includes('message')) {
        if (performance.now() - begin > 30000) {
          throw new Error('Initial transcript did not paint')
        }
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      mark('selectedPaintAfterRead')
    } finally {
      screen.free()
      ui.close()
    }

    await r.close()
    mark('remoteClose')
    console.log(JSON.stringify({ count, depth, run, times }))
  }
} finally {
  await Deno.remove(directory, { recursive: true })
}
