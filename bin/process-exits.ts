// T-126847: process rows on this box whose program is over keep no `exit`.
//
// Each row with no `exit` is judged by what this machine still shows, the pid
// checked first:
//
// 1. a workspace command (`process.workspace`): its receipt's `exit` file is
//    the code; a supervisor still running under its birth token is running; a
//    receipt that launched and is not running ended unseen; no receipt, or one
//    claimed and never launched, with no live pid and over a day old, never
//    ran and never will;
// 2. any other row: a live pid is left alone; a launch of @yaks/process takes
//    its `.code` file; anything else ended unseen.
//
// An ending unseen is `exit{}`, as a look writes it. Nothing is signalled.
//
//   deno run -A bin/process-exits.ts <yak.json> plan <out.jsonl>
//   deno run -A bin/process-exits.ts <yak.json> write <out.jsonl>
//   deno run -A bin/process-exits.ts <yak.json> undo <out.jsonl>

import * as fs from 'node:fs'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { dirOf } from '@yaks/process'
import { opened } from '../packages/cli/local.ts'

let [config, mode, out] = Deno.args
if (!['plan', 'write', 'undo'].includes(mode) || !out) {
  throw new Error('usage: <yak.json> plan|write|undo <out.jsonl>')
}
let host = await opened(config, ['graph'], false, mode == 'plan')
let g: Graph = host.graph
let home = Deno.env.get('HOME')!
let receipts = `${home}/.yak/workspace-receipts`
let processes = dirOf()
let DAY = 86_400_000
let now = Date.now()

type Row = { eid: Eid; exit: { code?: number }; why: string }

let read = (path: string) => {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
let alive = (pid: unknown) =>
  typeof pid == 'number' && pid > 0 && fs.existsSync(`/proc/${pid}`)
let boot = read('/proc/sys/kernel/random/boot_id')!.trim()
// The supervisor's pid, still the process it was: its boot and start time
// match the birth file (@yaks/machine execution.ts `owned`).
let owned = (d: string) => {
  let pid = Number(read(`${d}/pid`))
  let birth = read(`${d}/birth`)?.split('\n')
  let stat = read(`/proc/${pid}/stat`)
  if (!pid || !birth || !stat) return false
  let start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  return birth[0] == boot && birth[1] == start
}
let code = (text: string | undefined) => {
  let n = Number(text?.trim())
  return text?.trim() && Number.isSafeInteger(n) ? { code: n } : {}
}

let local = new Set(
  (await g.read('.machine&*')).filter((b) =>
    String((b.machine as Comp).address).startsWith('local:')
  ).map((b) => b.entity.eid),
)
let placed = new Map<string, boolean>()
let isLocal = async (workspace: string) => {
  if (!placed.has(workspace)) {
    let w = (await g.get([workspace], ['workspace']))[0]?.workspace as
      | Comp
      | undefined
    placed.set(workspace, !w?.sandbox && local.has(String(w?.machine)))
  }
  return placed.get(workspace)!
}

let judge = async (b: Bundle): Promise<Row | undefined> => {
  let eid = b.entity.eid
  let p = b.process as Comp
  let made = Date.parse(String((b.created as Comp | undefined)?.at ?? 0))
  let workspace = p.workspace as string | undefined
  if (workspace) {
    if (!await isLocal(workspace)) return
    let d = `${receipts}/${workspace}/${eid}`
    let exit = read(`${d}/exit`)
    if (exit != null) return { eid, exit: code(exit), why: 'receipt exit' }
    if (owned(d)) return
    if (fs.existsSync(`${d}/launched`)) {
      return { eid, exit: {}, why: 'launched, supervisor gone' }
    }
    if (alive(p.pid) || now - made < DAY) return
    return { eid, exit: {}, why: 'never launched' }
  }
  if (alive(p.pid)) return
  if (fs.existsSync(`${processes}/${eid}.started`)) {
    return {
      eid,
      exit: code(read(`${processes}/${eid}.code`)),
      why: 'launch, pid gone',
    }
  }
  return { eid, exit: {}, why: 'pid gone' }
}

if (mode == 'undo') {
  let rows: Row[] = fs.readFileSync(out, 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l))
  for (let i = 0; i < rows.length; i += 200) {
    await g.apply(
      rows.slice(i, i + 200).map((r) => ({
        entity: { eid: r.eid },
        exit: null,
      })),
    )
  }
  console.log(`undid ${rows.length}`)
} else {
  let rows: Row[] = []
  let running = await g.read('.process&!exit&*')
  for (let b of running) {
    let row = await judge(b)
    if (row) rows.push(row)
  }
  let tally: Record<string, number> = {}
  for (let r of rows) tally[r.why] = (tally[r.why] ?? 0) + 1
  console.log(
    JSON.stringify({ unexited: running.length, ended: rows.length, tally }),
  )
  if (mode == 'write') {
    fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    for (let i = 0; i < rows.length; i += 200) {
      await g.apply(
        rows.slice(i, i + 200).map((r) => ({
          entity: { eid: r.eid },
          exit: r.exit,
        })),
      )
    }
    let left = (await g.read('.process&!exit&.fields=entity.eid')).length
    console.log(JSON.stringify({ wrote: rows.length, left }))
  } else {fs.writeFileSync(
      out,
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    )}
}
await host.close?.()
Deno.exit(0)
