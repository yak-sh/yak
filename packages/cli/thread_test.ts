// The duty thread chooses one-shot or live work when its host asks. These
// tests exercise the worker boundary, where an eager pass once gated service.

import { assertEquals } from '@std/assert'
import { until } from '@yaks/testing'
import { thread } from './thread.ts'

let clock = async (pass = false) => {
  let dir = await Deno.makeTempDir()
  let plugin = new URL(`${dir}/clock`, 'file://').href
  let marker = `${dir}/mark`
  let config = `${dir}/yak.json`
  await Deno.mkdir(`${dir}/clock`)
  await Deno.writeTextFile(
    `${dir}/clock/service`,
    `export let service = async (_host, options, signal) => {
      if (signal.aborted && !options.pass) return await new Promise(() => {})
      if (signal.aborted) {
        await Deno.writeTextFile(options.marker, 'pass')
        return
      }
      await Deno.writeTextFile(options.marker, 'live')
      await new Promise((done) =>
        signal.addEventListener('abort', done, { once: true }))
    }
    `,
  )
  await Deno.writeTextFile(
    config,
    JSON.stringify({
      db: ':memory:',
      plugins: [{ use: plugin, with: { marker, pass } }],
    }),
  )
  return { config, dir, marker, plugin }
}

Deno.test('live duties do not wait on a one-shot pass', async () => {
  let { config, dir, marker, plugin } = await clock()
  let aside = thread()
  let stop = new AbortController()
  aside.plan({ config, roles: [plugin] })
  let live = aside.duties(stop.signal)
  let failed: unknown
  let settled = false
  live.then(() => (settled = true), (error) => (failed = error))
  try {
    await until(async () => {
      if (failed) throw failed
      return await Deno.readTextFile(marker).catch(() => '')
    }, {
      timeout: 5000,
      label: () =>
        `the live duty (settled ${settled}, failed ${String(failed)})`,
    })
    assertEquals(await Deno.readTextFile(marker), 'live')
    stop.abort()
    await live
    await aside.close()
  } finally {
    stop.abort()
    aside.end()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('an ended duty signal runs one pass', async () => {
  let { config, dir, marker, plugin } = await clock(true)
  let aside = thread()
  aside.plan({ config, roles: [plugin] })
  try {
    await aside.duties(AbortSignal.abort())
    assertEquals(await Deno.readTextFile(marker), 'pass')
    await aside.close()
  } finally {
    aside.end()
    await Deno.remove(dir, { recursive: true })
  }
})
