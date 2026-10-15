// The Worker is a double at its doors: it pages its bugs by eid and records
// marks; which door a mark goes to is `marking`'s (./remote.ts). A poll that
// fails or hangs is asked through the signed transport, which is what names
// its failure.
import { clock, equal, test } from '@yaks/testing'
import { type Doors, poll, type Polled, signed } from './poll.ts'

let worker = (count: number) => {
  let bugs = Array.from({ length: count }, (_, i) => ({
    entity: { eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
    bug: { fault: `f${i}` },
  }))
  let marks: string[] = []
  let doors: Doors = {
    bugs: (params) => {
      let after = params.get('query')?.match(/\.after=(\S+)/)?.[1] ?? ''
      let limit = Number(params.get('limit'))
      return Promise.resolve({
        ok: true,
        value: bugs.filter((b) => b.entity.eid > after).slice(0, limit),
      })
    },
    mark: (bug, name, said) => {
      marks.push([name, bug, ...Object.values(said)].join(' '))
      return Promise.resolve(true)
    },
  }
  return { doors, marks }
}
let remote = { url: 'https://tracker.example', secret: 'test' }

// The poll once it has answered or failed, as its subscribers hear it.
let polled = (open: Polled) =>
  new Promise<Polled>((done) => {
    let off = open.subscribe(() => {
      off()
      done(open)
    })
  })

test('a poll answers every page of the platform tracker, and marks reach it', async () => {
  let { doors, marks } = worker(230)
  let open = await polled(poll(remote, '.bug', { doors }))
  equal(open.value.length, 230)
  await open.mutate([
    { entity: { eid: 'a' }, resolved: { at: 'now', cause: 'race' } },
    { entity: { eid: 'b' }, archived: {} },
    { entity: { eid: 'c' }, doc: { title: 'no mark' } },
    { entity: { eid: 'd' }, taken: { task: 'T-7' } },
  ])
  equal(marks, ['resolved a race', 'archived b', 'taken d T-7'])
  open.close()
})

test('a failed poll is reported and leaves the answer not ready', async () => {
  let failures: unknown[] = []
  let open = await polled(poll(remote, '.bug', {
    doors: signed(
      remote,
      (() =>
        Promise.resolve(new Response('', { status: 500 }))) as typeof fetch,
    ),
    report: (error) => failures.push(error),
  }))
  equal([open.ready, failures.map(String)], [false, [
    'Error: Remote tracker refused the read (500)',
  ]])
  open.close()
})

test('a poll that hangs settles as failed, and says it timed out', async () => {
  let failures: unknown[] = []
  let time = clock()
  // A fetch that never answers, until its signal gives up on it.
  let hang = ((_: unknown, init?: RequestInit) =>
    new Promise((_, fail) => {
      let signal = init!.signal!
      if (signal.aborted) fail(signal.reason)
      signal.addEventListener('abort', () => fail(signal.reason))
    })) as typeof fetch
  let hung = polled(poll(remote, '.bug', {
    timeout: 5,
    timer: (fn, ms) => time.after(ms, fn),
    doors: signed(remote, hang),
    report: (error) => failures.push(error),
  }))
  await time.advance(5)
  let open = await hung
  equal([open.ready, failures.map(String)], [false, [
    'Error: Remote tracker did not answer in time',
  ]])
  open.close()
})
