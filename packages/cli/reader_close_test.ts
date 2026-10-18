// Reader teardown finishes before telemetry drains, including close failures.
import { equal, test } from '@yaks/testing'
import { files } from '@yaks/tracker/file'
import { comp } from '../tracker/model.ts'
import { compose } from './host.ts'
import { reporter } from './report.ts'

let closing = await (async () => {
  let dir = await Deno.makeTempDir()
  let log = console.error
  console.error = () => {}
  try {
    let spool = `${dir}/spool`
    let host = await compose(
      { db: ':memory:', tracker: { spool } },
      ['graph'],
      undefined,
      {
        reader: {
          read: () => [],
          rows: () => [],
          get: () => [],
          close: () => {
            throw new Error('reader teardown failed')
          },
        },
      },
    )
    await host.close()
    let rows = (await Array.fromAsync(files(spool).source()))
      .flatMap((record) => record.rows)
    return rows.filter((row) => row.error)
  } finally {
    console.error = log
    await Deno.remove(dir, { recursive: true })
  }
})()

test('an unexpected reader teardown failure is durable before host close returns', () => {
  equal(closing.length, 1)
  equal(comp(closing[0], 'exception').value, 'reader teardown failed')
  equal(comp(closing[0], 'error').tags, {
    source: 'box',
    command: 'yak',
    roles: 'graph',
    step: 'close reader',
  })
})

let reporting = await (async () => {
  let dir = await Deno.makeTempDir(), log = console.error
  console.error = () => {}
  try {
    let commit = Promise.withResolvers<string>()
    let report = reporter(
      { tracker: { spool: `${dir}/spool` } },
      undefined,
      commit.promise,
    )
    let first = report(new Error('first failure'))
    let finished = false
    let second = first.then(async () => {
      await report(new Error('failure while draining'))
      finished = true
    })
    let closing = report.close()
    commit.resolve('a'.repeat(40))
    await closing
    let drained = finished
    await second
    return drained
  } finally {
    console.error = log
    await Deno.remove(dir, { recursive: true })
  }
})()

test('reporter close includes failures reported while it is already draining', () => {
  equal(reporting, true)
})
