// The land guard at settle, on the GRAPH-NATIVE session shape: a run that ends
// with commits its base does not carry wears the UNLANDED `error` and says so
// on its work thread, exactly as a process-backed run does (sessions_test). The
// production sequence is here whole — the runner's own turn, cast through
// maintainStandingFor, which is the writer that stamps the ending and settles —
// so a later writer that sheds the verdict fails this file. S-35264 is why: it
// settled clean with a commit stranded on its branch, because the clean turn's
// health shed deleted the `error` the settle had written 28ms earlier.
Deno.env.set('DB_PATH', ':memory:')

import { assert, assertEquals, assertMatch } from '@std/assert'
import { apply } from './db.ts'
import { db } from './live_db.ts'
import { managedCodex } from './managed_codex.ts'
import { type ResponseResult } from './responses.ts'
import { writeSession } from './session_store.ts'
import { maintainStandingFor } from './sessions.ts'
import { type Change, uuid } from './types.ts'

let OWNED = `entity = (select id from entity where eid = ?)`

let git = (cwd: string, ...args: string[]) => {
  let ran = new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync()
  if (!ran.success) {
    throw new Error(
      `git ${args.join(' ')}: ${new TextDecoder().decode(ran.stderr)}`,
    )
  }
}

// One scratch repo, cut at IMPORT time so no test pays for it: `main`, and a
// session branch two empty commits ahead of it. Empty commits keep it cheap —
// the guard reads ancestry and a count, never a tree.
let repo = Deno.makeTempDirSync({ prefix: 'settle-land-' })
let branch = 'session/S-test'
git(repo, 'init', '-b', 'main', '-q')
git(repo, 'config', 'user.email', 'test@example.com')
git(repo, 'config', 'user.name', 'test')
git(repo, 'commit', '-q', '--allow-empty', '-m', 'base')
git(repo, 'checkout', '-q', '-b', branch)
git(repo, 'commit', '-q', '--allow-empty', '-m', 'one')
git(repo, 'commit', '-q', '--allow-empty', '-m', 'two')

// The server's own cast: it maintains the native `standing` facet on every
// broadcast batch, and that stamp is what ends the run and settles it.
let cast = (changes: Change[]) => maintainStandingFor(changes, cast)

// A provider turn that answers and stops: the final answer is what
// sessionStateOf reads as `completed`.
let answer = (text: string): ResponseResult => ({
  model: 'gpt-serving',
  items: [{
    type: 'message',
    id: 'item-1',
    phase: 'final_answer',
    content: [{ type: 'output_text', text }],
  }],
  unknown: [],
  unknownItems: [],
  usage: { input: 1, cached: 0, output: 1, reasoning: 0, raw: {} },
  response: {},
  limits: {},
})

let runner = () =>
  managedCodex({
    db,
    cast,
    transport: { run: () => Promise.resolve(answer('done')) },
    tools: () =>
      Promise.resolve({
        tools: [],
        call: () => Promise.resolve({ output: '' }),
      }),
    prepare: () => Promise.resolve(),
  })

let launch = (on = branch) => ({
  instruction: 'Do the task.',
  session_id: uuid(),
  repo: { path: repo, base_branch: 'main' },
  tree: repo,
  branch: on,
  model: 'gpt-requested',
})

// A graph-native session on the scratch repo, with the task it reports to.
let native = (on = branch) => {
  let project = uuid(), task = uuid(), eid = uuid()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Scratch', body: '' } },
    { eid: project, name: 'project', comp: {} },
    { eid: project, name: 'repo', comp: { path: repo, base_branch: 'main' } },
    { eid: task, name: 'doc', comp: { title: 'Stranded work', body: '' } },
    { eid: task, name: 'task', comp: {} },
    { eid: task, name: 'filed', comp: { project, priority: 'P2' } },
    {
      eid,
      name: 'session',
      comp: { id: uuid(), provider: 'codex', requested_task: task, cwd: repo },
    },
  ])
  writeSession(db, eid, { origin: 'managed', branch: on })
  return { eid, task }
}

let statusOf = (eid: string) =>
  (db.prepare(`select status from session where ${OWNED}`).get(eid) as
    | { status: string }
    | undefined)?.status

let errorOf = (eid: string) =>
  (db.prepare(`select message from error where ${OWNED}`).get(eid) as
    | { message: string }
    | undefined)?.message

let comments = (task: string) =>
  (db.prepare(
    `select d.body from comment c join doc_value d on d.entity = c.entity
     where c.target = (select id from entity where eid = ?)`,
  ).all(task) as { body: string }[]).map((row) => row.body)

Deno.test(
  'a graph-native run that ends ahead of its base wears UNLANDED and says so',
  async () => {
    let { eid, task } = native()
    await runner().start(eid, launch())

    assertEquals(statusOf(eid), 'completed')
    // The verdict SURVIVES the clean turn's health shed: the run ended well
    // and still left work behind, and only the writer of a facet may clear it.
    assertMatch(
      errorOf(eid) ?? '',
      new RegExp(`^UNLANDED: 2 commits on ${branch} not in main`),
    )
    let said = comments(task)
    assertEquals(said.length, 1)
    assertMatch(
      said[0],
      new RegExp(`⚠ UNLANDED: 2 commits on ${branch} not in main`),
    )
  },
)

Deno.test('a graph-native run whose base carries its branch settles clean', async () => {
  let { eid, task } = native('main')
  await runner().start(eid, launch('main'))

  assertEquals(statusOf(eid), 'completed')
  assertEquals(errorOf(eid), undefined)
  assert(!comments(task).some((body) => body.includes('UNLANDED')))
})
