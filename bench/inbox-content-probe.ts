/** A disposable browse host with the production Inbox facet and summary reads.
 * Only graph/web roles are composed: no importer, mail or detached duties run.
 */
import type { Bundle } from '@yaks/graph'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { open, primer } from './pages.ts'
import { COUNT, HISTORY, inboxPages, PERSON, PROJECT } from './inbox-content.ts'

let dir = await Deno.makeTempDir({ prefix: 'T-127095-inbox-' })
let host: Awaited<ReturnType<typeof compose>> | undefined
let server: Deno.HttpServer<Deno.NetAddr> | undefined
let blank: ReturnType<typeof primer> | undefined
try {
  let config = starter(PERSON)
  config.db = `${dir}/yak.db`
  config.duties = false
  config.plugins!.push(
    '@yaks/inspect',
    '@yaks/inbox',
    '@yaks/notify',
    '@yaks/mail',
  )
  config.plugins = config.plugins!.map((p) =>
    p == '@yaks/session'
      ? {
        use: '@yaks/session',
        with: { transcripts: `${dir}/empty-transcripts` },
      }
      : p
  )
  await Deno.mkdir(`${dir}/empty-transcripts`)
  let path = `${dir}/yak.json`
  await Deno.writeTextFile(path, JSON.stringify(config))
  host = await compose(read(path), ['graph', 'web'])
  let rows: Bundle[] = [
    {
      entity: { eid: PERSON },
      person: {},
      doc: { title: 'Inbox benchmark person' },
    },
    {
      entity: { eid: PROJECT },
      project: {},
      doc: { title: 'Inbox benchmark project' },
    },
  ]
  let latest: Bundle[] = []
  for (let i = 0; i < COUNT; i++) {
    let person = crypto.randomUUID(), project = crypto.randomUUID()
    rows.push(
      {
        entity: { eid: person },
        task: {},
        filed: { assignee: PERSON },
        doc: { title: `Person Inbox thread ${i}`, body: 'An assigned task.' },
      },
      {
        entity: { eid: crypto.randomUUID() },
        comment: { target: person },
        doc: { body: HISTORY },
      },
      {
        entity: { eid: project },
        task: {},
        doc: { title: `Project Inbox thread ${i}` },
      },
      {
        entity: { eid: crypto.randomUUID() },
        knock: { target: project },
        deliver: { to: PROJECT },
      },
    )
    latest.push({
      entity: { eid: crypto.randomUUID() },
      comment: { target: person },
      doc: { body: `Newest Inbox reply ${i}` },
    })
  }
  await host.graph.apply(rows)
  await host.graph.apply(latest)
  if (!host.handler) throw new Error('Inbox host has no HTTP handler')
  server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen() {} },
    host.handler,
  )
  let base = `http://127.0.0.1:${server.addr.port}`
  // Build the production browser bundle before timing page navigation, just as
  // the running host does. This is not a substitute for its content predicate.
  let bundle = await fetch(base + '/web/app.js')
  if (!bundle.ok) {
    throw new Error(
      `Inbox bundle failed: ${bundle.status} ${await bundle.text()}`,
    )
  }
  await bundle.arrayBuffer()
  blank = primer()
  let out: Record<string, number> = {}
  for (let page of inboxPages()) {
    let figures = await open(base, page, blank.url)
    console.error(page.name, JSON.stringify(figures))
    Object.assign(out, figures)
  }
  console.log('INBOX_CONTENT_RESULT=' + JSON.stringify(out))
} finally {
  await blank?.close()
  await server?.shutdown()
  await host?.close()
  await Deno.remove(dir, { recursive: true })
}
