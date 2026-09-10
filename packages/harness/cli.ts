// The verbs, over @yaks/cli's plugin seam: start a transcript, say something
// more to one, list them, read one back, and ask what the credential can
// reach. Five words and no state of their own — each one opens the graph, does
// the one thing, and closes it, because the file IS the harness and two
// commands a minute apart are the same harness.
//
// Nothing is printed by hand. An entry prints through @yaks/render's session
// views and @yaks/text (run.ts `line`), the same trees a browser or a terminal
// UI mounts, so a listing and a transcript cannot drift from what any other
// door shows.

import type { Comp, Eid } from '@yaks/graph'
import { type Ctx, type Plugin, saidIn } from '@yaks/cli'
import { codexPaths, fromCodex, fromEnv } from '@yaks/openai'
import { type Agent, agent, titleOf } from './run.ts'
import { dbPath } from './store.ts'

/** What every transcript here is told it is. */
export let INSTRUCTIONS =
  'You are an agent in a self-contained harness. You have a shell, and the ' +
  'graph you yourself live in: your transcript, the work on your list and ' +
  'the programs you start are all entities you can read and write with the ' +
  'graph_ tools. Be terse; say what you did, not what you are about to do.'

let said = (c: Ctx) => {
  let { opts, words } = saidIn(c.args)
  let opt = (name: string) => {
    let hit = opts.find(([k]) => k == name)?.[1]
    return typeof hit == 'string' ? hit : undefined
  }
  return { opt, words }
}

// One harness, its steps printed as they land. Opened per verb: the graph is a
// file, and holding it open between commands would buy nothing.
let running = (c: Ctx, name?: string): Agent => {
  let a: Agent = agent({
    name,
    instructions: INSTRUCTIONS,
    each: (step) => step.added.forEach((b) => c.out('  ' + a.line(b))),
  })
  return a
}

/** The session a person typed: its eid, its short id, or the start of
 * either. */
let sessionAt = async (a: Agent, id: string): Promise<Eid | undefined> => {
  let rows = await a.sessions()
  let is = (want: string) => (b: { entity: { eid: Eid } }) =>
    b.entity.eid == want
  return (rows.find(is(id)) ??
    rows.find((b) => String((b.session as Comp).id) == id) ??
    rows.find((b) => b.entity.eid.startsWith(id)))?.entity.eid
}

let start = async (c: Ctx): Promise<number> => {
  let { opt, words } = said(c)
  let prompt = words.join(' ')
  if (!prompt) {
    c.note('want a prompt: harness new "<what to do>"')
    return 2
  }
  let a = running(c, opt('model'))
  try {
    let s = await a.start(prompt, { effort: opt('effort') })
    c.out(`session ${s.slice(0, 8)} — ${a.h.path}`)
    await a.idle(s)
    return 0
  } finally {
    a.close()
  }
}

let send = async (c: Ctx): Promise<number> => {
  let { opt, words } = said(c)
  let [id, ...rest] = words
  let a = running(c, opt('model'))
  try {
    let s = id && await sessionAt(a, id)
    if (!s) {
      c.note(`no such session: ${id ?? ''}`)
      return 2
    }
    await a.send(s, rest.join(' '))
    await a.idle(s)
    return 0
  } finally {
    a.close()
  }
}

let ls = async (c: Ctx): Promise<number> => {
  let a = running(c)
  try {
    let rows = await a.sessions()
    for (let row of rows) {
      let entries = await a.transcript(row.entity.eid)
      c.out(`${a.line(row, 'Status', { entries })}  ${titleOf(entries)}`)
    }
    if (!rows.length) c.note(`no sessions in ${a.h.path}`)
    return 0
  } finally {
    a.close()
  }
}

let show = async (c: Ctx): Promise<number> => {
  let { words } = said(c)
  let a = running(c)
  try {
    let s = words[0] && await sessionAt(a, words[0])
    if (!s) {
      c.note(`no such session: ${words[0] ?? ''}`)
      return 2
    }
    let entries = await a.transcript(s)
    let [self] = await a.h.g.storage.tx((tx) => tx.get([s]))
    c.out(a.line(self, 'Status', { entries }))
    for (let b of entries) c.out('  ' + a.line(b))
    return 0
  } finally {
    a.close()
  }
}

let tasks = async (c: Ctx): Promise<number> => {
  let a = running(c)
  try {
    for (let t of await a.tasks()) {
      let held = (t.claim as Comp | undefined)?.session
      c.out(
        `${String(t.entity.num ?? t.entity.eid.slice(0, 8)).padStart(4)}  ` +
          `${String((t.task as Comp).status ?? 'open').padEnd(7)}  ` +
          `${String((t.doc as Comp)?.title ?? t.entity.eid)}` +
          (held ? `  (held by ${String(held).slice(0, 8)})` : ''),
      )
    }
    return 0
  } finally {
    a.close()
  }
}

// What the harness would sign an ask with, and where it found it. The token
// itself is never printed — only which door it opens.
let models = async (c: Ctx): Promise<number> => {
  let env = Deno.env.get
  let key = fromEnv(env)
  let found = key ? { at: 'OPENAI_API_KEY', cred: key } : undefined
  if (!found) {
    for (let path of codexPaths(env)) {
      let cred = await Promise.resolve(c.reads.file(path))
        .then(fromCodex, () => undefined)
      if (cred) {
        found = { at: path, cred }
        break
      }
    }
  }
  if (!found) {
    c.note('no credential: set OPENAI_API_KEY or sign in to Codex')
    return 1
  }
  c.out(`credential from ${found.at} → ${found.cred.base}`)
  let res = await fetch(`${found.cred.base}/models`, {
    headers: {
      authorization: `Bearer ${found.cred.token}`,
      ...found.cred.account ? { 'chatgpt-account-id': found.cred.account } : {},
    },
  }).catch((e) => e as Error)
  if (res instanceof Error) {
    c.note(`could not reach it: ${res.message}`)
    return 1
  }
  let body = await res.text()
  if (!res.ok) {
    c.note(
      `${found.cred.base}/models says ${res.status}: ${body.slice(0, 200)}`,
    )
    c.note('the backend may not list models; ask for one by name with --model')
    return 0
  }
  let listed = JSON.parse(body) as { data?: { id: string }[] }
  for (let m of listed.data ?? []) c.out(`  ${m.id}`)
  return 0
}

/** The harness's verbs, for a `yak` (or a `harness`) that carries them. */
export let plugin: Plugin = {
  name: '@yaks/harness',
  about: `the harness — its own graph at ${dbPath()}`,
  verbs: () => [
    {
      name: 'new',
      args: '<prompt> [--model m] [--effort e]',
      about: 'start a transcript and run it until it settles',
      run: start,
    },
    {
      name: 'send',
      args: '<session> <text>',
      about: 'say something more to a transcript',
      run: send,
    },
    { name: 'ls', about: 'every session, with its status', run: ls },
    {
      name: 'show',
      args: '<session>',
      about: 'one transcript, in full',
      run: show,
    },
    { name: 'tasks', about: 'the open work in the harness graph', run: tasks },
    {
      name: 'models',
      about: 'the credential found, and what it reaches',
      run: models,
    },
  ],
}
