// A leaving worker stops waiting without stopping a command or losing its receipt.
import { equal, ok, test } from '@yaks/testing'
import type { Machine } from './mod.ts'
import { machineTools } from './tools.ts'

let fixture = (name: string) => {
  let stop = new AbortController()
  let killed = false
  let looks = 0
  let m: Machine = {
    start: () => Promise.resolve('command'),
    receipt: () => Promise.resolve('command'),
    look: () => {
      if (++looks > 1 && !recovery) throw new Error('wait ignored shutdown')
      stop.abort()
      return Promise.resolve({ pid: 123 })
    },
    tail: () => Promise.resolve(['output kept']),
    kill: () => {
      killed = true
      return Promise.resolve()
    },
    read: () => Promise.resolve(''),
    stat: () => Promise.resolve([]),
    write: () => Promise.resolve(),
  }
  let recovery = false
  let tool = machineTools(m).find((t) => t.name == name)!
  let ctx = {
    session: 'session',
    call: { entity: { eid: 'call' } },
    entries: [],
    signal: stop.signal,
  }
  return {
    tool,
    ctx,
    killed: () => killed,
    recovering: () => recovery = true,
  }
}

for (let name of ['shell', 'wait']) {
  let f = fixture(name)
  test(`${name} hands back the process when its worker drains`, async () => {
    let result = await f.tool.run({
      command: 'long command',
      process: 'command',
      timeout: 2_000_000,
    }, f.ctx)
    ok(result.includes('process command still running'))
    ok(result.includes('output kept'))
    equal(f.killed(), false)
    if (name == 'shell') {
      f.recovering()
      ok((await f.tool.recover!({}, f.ctx))?.includes('process command'))
    }
  })
}
