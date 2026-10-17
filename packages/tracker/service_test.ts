// Local admission keeps working while the remote outbox is unavailable.
import { equal, ok, test, throws, until } from '@yaks/testing'
import { files } from './file.ts'
import { service } from './service.ts'
import { capture } from './report.ts'
import { fixture } from './fixture_test.ts'
import { group } from './group.ts'
import { comp } from './model.ts'

let remote = { url: 'https://tracker.example', secret: 'test' }
let append = (dir: string, eid: string) =>
  files(dir).append(
    JSON.stringify(capture('broken', { eid, sink: () => {} })) + '\n',
  )
let entries = (dir: string) => Array.fromAsync(files(dir).source())

test('remote refusal keeps durable local receipts across restart and retention', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let g = fixture()
    await append(dir, 'first')
    await append(dir, 'second')
    let calls = 0
    let down = (() => {
      calls++
      return Promise.resolve(new Response(null, { status: 503 }))
    }) as typeof fetch
    await throws(() =>
      service({ graph: g }, { spool: dir, remote, fetch: down })
    )
    equal((await g.read('.error')).length, 2)
    equal((await entries(dir)).map((r) => r.admitted), [true, true])
    for (let eid of ['first', 'second']) await group(g, eid, (row) => row)
    equal(comp((await g.read('.bug *'))[0], 'bug').hits, 2)
    // Local retention may remove an occurrence during a remote outage. A
    // durable receipt must keep replay from counting it as another occurrence.
    await g.apply([{ entity: { eid: 'first' }, $delete: true }], {
      trusted: true,
    })
    await throws(() =>
      service({ graph: g }, { spool: dir, remote, fetch: down })
    )
    equal((await g.read('.error .entity.eid=first')).length, 0)
    equal(calls, 2)
    let sent: string[] = []
    await service({ graph: g }, {
      spool: dir,
      remote,
      fetch: ((_url, init) => {
        sent.push(JSON.parse(String(init?.body))[0].entity.eid)
        return Promise.resolve(new Response(null))
      }) as typeof fetch,
    })
    equal(sent, ['first', 'second'])
    equal(await entries(dir), [])
    equal(comp((await g.read('.bug *'))[0], 'bug').hits, 2)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('a held remote send cannot block later local admission or local retries', async () => {
  let dir = await Deno.makeTempDir()
  let stop = new AbortController()
  let release!: () => void
  let held = new Promise<void>((resolve) => release = resolve)
  let running: Promise<void> | undefined
  try {
    let g = fixture()
    let fail = false, reports = 0, sending = false
    let graph = {
      ...g,
      apply: async (...args: Parameters<typeof g.apply>) => {
        if (fail) {
          fail = false
          throw Error('temporary local failure')
        }
        return await g.apply(...args)
      },
    }
    await append(dir, 'first')
    running = service({ graph }, {
      spool: dir,
      remote,
      every: 1,
      report: () => reports++,
      fetch: (async () => {
        sending = true
        await held
        return Promise.resolve(new Response(null))
      }) as typeof fetch,
    }, stop.signal)
    await until(() => sending)
    fail = true
    await append(dir, 'later')
    await until(async () => (await g.get(['later'])).length > 0)
    equal(reports, 1)
    equal((await g.read('.error')).length, 2)
    ok((await entries(dir)).every((r) => r.admitted))
    stop.abort()
    release()
    await running
  } finally {
    stop.abort()
    release()
    await running
    await Deno.remove(dir, { recursive: true })
  }
})

test('a locally refused record is never sent or acknowledged', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let g = fixture(), calls = 0
    await append(dir, 'refused')
    await throws(() =>
      service({
        graph: {
          ...g,
          apply: () => {
            throw Error('offline')
          },
        },
      }, {
        spool: dir,
        remote,
        report: () => {},
        fetch: (() => {
          calls++
          return Promise.resolve(new Response(null))
        }) as typeof fetch,
      })
    )
    equal(calls, 0)
    equal((await entries(dir)).map((r) => r.admitted), [false])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
