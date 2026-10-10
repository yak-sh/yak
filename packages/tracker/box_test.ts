// The installed tracker worker must run the clock that releases notification
// batches, as well as intake and effects. Exercise its declared roles together.
import { match, test, until } from '@yaks/testing'
import { compose } from '../cli/host.ts'
import { type Config } from '../cli/config.ts'

let unit = Deno.readTextFileSync(
  new URL('./yak-tracker@.service', import.meta.url),
)
let box = JSON.parse(
  Deno.readTextFileSync(new URL('./box.json', import.meta.url)),
) as Config
let roles = unit.match(/--roles (\S+)/)![1].split(',')

test('box worker fires notification wakes and delivers new and regressed bugs', async () => {
  let to = crypto.randomUUID()
  let bug = crypto.randomUUID()
  let host = await compose({
    db: ':memory:',
    plugins: [
      ...box.plugins!.filter((p) =>
        typeof p == 'string' && [
          '@yaks/kernel',
          '@yaks/id',
          '@yaks/archetype',
          '@yaks/doc',
          '@yaks/tools',
          '@yaks/api',
          '@yaks/process',
          '@yaks/effects',
        ].includes(p)
      ),
      { use: '@yaks/mail', with: { sender: { via: 'stash' } } },
      { use: '@yaks/wake', with: { cap: 1 } },
      {
        use: '@yaks/tracker',
        with: { to, from: 'task@example.test', store: crypto.randomUUID() },
      },
    ],
  }, ['graph', ...roles])
  let g = host.graph
  let stop = new AbortController()
  let running: Promise<void> | undefined
  let delivered = (count: number) =>
    until(async () =>
      (await g.read('.mail .delivered')).length == count &&
      (await g.read('.bug .notified')).length == 1, {
      timeout: 2000,
      label: 'notification delivered and bug marked',
    })
  try {
    await g.apply([
      { entity: { eid: to }, email: { address: 'owner@example.test' } },
      {
        entity: { eid: bug },
        bug: { fault: 'box-notification' },
        doc: { title: 'Broken on the box' },
        created: { at: '2026-01-01T00:00:10Z' },
      },
    ], { trusted: true })
    running = host.duties(stop.signal)
    await delivered(1)
    let [letter] = await g.read('.mail *')
    match(letter.mail, {
      at: '2026-01-01T00:00:10Z',
      from: 'task@example.test',
      to: 'owner@example.test',
      message_id: 'stash-1',
    })
    // Regression removes the earlier notification, and opens a new minute.
    await g.apply([{
      entity: { eid: bug },
      notified: null,
      wake: null,
      fired: null,
      regressed: { at: '2026-01-01T00:01:10Z' },
    }], { trusted: true })
    await delivered(2)
  } finally {
    stop.abort()
    await running
    await host.close()
  }
})
