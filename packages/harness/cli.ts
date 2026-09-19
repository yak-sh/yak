import { tools as declared } from './declared.ts'
// The tools @yaks/cli runs: start a transcript, say something more to one,
// list them, read one back, and ask what the credential can reach. A handful
// of words and no state of their own — each one opens the graph, does the one
// thing, and closes it, because the file IS the harness and two commands a
// minute apart are the same harness.
//
// Nothing is printed by hand. An entry prints through @yaks/render's session
// views and @yaks/text (run.ts `line`), the same trees a browser or a terminal
// UI mounts, so a listing and a transcript cannot drift from what any other
// door shows.

import { type Comp, type Eid, land } from '@yaks/graph'
import { type Ctx, type Word } from '@yaks/cli'
import { codexPaths, fromCodex, fromEnv } from '@yaks/openai'
import { type Agent, agent, titleOf } from './run.ts'
import { open } from './store.ts'

type Args = Record<string, unknown>
let word = (args: Args, name: string): string | undefined => {
  let v = args[name]
  return typeof v == 'string' ? v : undefined
}

// One harness, its steps printed as they land. Opened per tool: the graph is a
// file, and holding it open between commands would buy nothing.
let running = (args: Args, c: Ctx): Agent => {
  let a: Agent = agent({
    name: word(args, 'model'),
    provider: word(args, 'provider'),
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

let start = async (args: Args, c: Ctx): Promise<number> => {
  let prompt = String(args.prompt ?? '')
  let a = running(args, c)
  try {
    let s = await a.start(prompt, { effort: word(args, 'effort') })
    c.out(`session ${s.slice(0, 8)} — ${a.h.path}`)
    await a.idle(s)
    return 0
  } finally {
    await a.close()
  }
}

let send = async (args: Args, c: Ctx): Promise<number> => {
  let id = String(args.session)
  let a = running(args, c)
  try {
    let s = await sessionAt(a, id)
    if (!s) {
      c.note(`no such session: ${id}`)
      return 2
    }
    await a.send(s, String(args.text))
    await a.idle(s)
    return 0
  } finally {
    await a.close()
  }
}

let ls = async (args: Args, c: Ctx): Promise<number> => {
  let a = running(args, c)
  try {
    let rows = await a.sessions()
    for (let row of rows) {
      let entries = await a.transcript(row.entity.eid)
      c.out(`${a.line(row, 'Status', { entries })}  ${titleOf(entries)}`)
    }
    if (!rows.length) c.note(`no sessions in ${a.h.path}`)
    return 0
  } finally {
    await a.close()
  }
}

let show = async (args: Args, c: Ctx): Promise<number> => {
  let a = running(args, c)
  try {
    let s = await sessionAt(a, String(args.session))
    if (!s) {
      c.note(`no such session: ${args.session}`)
      return 2
    }
    let entries = await a.transcript(s)
    let [self] = await a.h.g.storage.tx((tx) => tx.get([s]))
    c.out(a.line(self, 'Status', { entries }))
    for (let b of entries) c.out('  ' + a.line(b))
    return 0
  } finally {
    await a.close()
  }
}

let tasks = async (args: Args, c: Ctx): Promise<number> => {
  let a = running(args, c)
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
    await a.close()
  }
}

// What the harness would sign an ask with, and where it found it. The token
// itself is never printed — only which door it opens.
let models = async (_args: Args, c: Ctx): Promise<number> => {
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

// Every tool takes the same two presentation options, so one harness graph is
// opened the same way whatever the word was.
let howto = (props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    ...props,
    model: { type: 'string', description: 'which model to speak to' },
    provider: { type: 'string', description: 'which backend' },
  },
})

/** The harness's own words, for a `yak` (or a `harness`) that carries them. */
export let own: Word[] = [
  {
    name: 'new',
    description: 'start a transcript and run it until it settles',
    inputSchema: {
      ...howto({
        prompt: { type: 'string', description: 'what to do' },
        effort: { type: 'string', description: 'how hard to think' },
      }),
      required: ['prompt'],
    },
    options: { positional: ['prompt'] },
    run: start,
  },
  {
    name: 'send',
    description: 'say something more to a transcript',
    inputSchema: {
      ...howto({
        session: { type: 'string', description: 'the transcript' },
        text: { type: 'string', description: 'what to say' },
      }),
      required: ['session', 'text'],
    },
    options: { positional: ['session', 'text'] },
    run: send,
  },
  {
    name: 'ls',
    description: 'every session, with its status',
    inputSchema: howto({}),
    readOnly: true,
    run: ls,
  },
  {
    name: 'show',
    description: 'one transcript, in full',
    inputSchema: {
      ...howto({ session: { type: 'string' } }),
      required: ['session'],
    },
    options: { positional: ['session'] },
    readOnly: true,
    run: show,
  },
  {
    name: 'tasks',
    description: 'the open work in the harness graph',
    inputSchema: howto({}),
    readOnly: true,
    run: tasks,
  },
  {
    name: 'models',
    description: 'the credential found, and what it reaches',
    inputSchema: howto({}),
    readOnly: true,
    run: models,
  },
]

// A tool the VOCABULARY declares (declared.ts) runs against a graph rather
// than a command line, so it is run here and its structured result printed. The word order and the arguments are @yaks/cli's
// either way — nothing about a graph tool is spelled twice.
let overGraph = (tool: typeof declared[number]): Word => ({
  ...tool,
  run: async (args, c) => {
    let h = open()
    try {
      // The command line is a HOST: the tool says what it wants done, the
      // landing happens here, and what it answers is printed.
      let call = {
        graph: h.g,
        actor: null,
        read: (query: Parameters<typeof h.g.read>[0], opts?: unknown) =>
          h.g.read(query, opts as undefined),
      }
      let intent = await tool.run(args, call)
      let value = await land(intent, call)
      if (value !== undefined) c.out(JSON.stringify(value, null, 2))
      return 0
    } finally {
      h.close()
    }
  },
})

/** Every word `harness` answers to: the graph's tools, then its own. */
export let tools: Word[] = [...declared.map(overGraph), ...own]
