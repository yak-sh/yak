// The graph-native harness through its production seams: Responses transport,
// durable scheduler, MCP-backed Tasks tools, and host-backed local tools. A
// scripted provider drives context → shell → patch → final while every durable
// and replayable surface is scanned for credential markers.
import { assertEquals, assertMatch } from '@std/assert'
import { rows } from './client.ts'
import { apply, journalOf, open, snapshot } from './db.ts'
import { readEntries } from './entries.ts'
import { evalGraph } from './graph_query.ts'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { managedCodex } from './managed_codex.ts'
import { type IO } from './mcp.ts'
import { responses } from './responses.ts'
import { attentionPrompt } from './runner.ts'
import { sessionRow, writeSession } from './session_store.ts'
import { uuid } from './types.ts'
import { slow } from './testing.ts'
import { freshDb } from './testdb.ts'

Deno.env.set('DB_PATH', ':memory:')

let sse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )

let complete = (item: Record<string, unknown>, leak: string) =>
  sse(
    { type: 'response.future.delta', leak },
    { type: 'response.output_item.done', item: { ...item, leak } },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        model: 'gpt-served',
        usage: {
          input_tokens: 8,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    },
  )

let ioFor = (db: ReturnType<typeof open>): IO => ({
  read: () => Promise.resolve(snapshot(db)),
  query: (q, opts) => Promise.resolve(evalGraph(db, q, opts).hits),
  write: (changes, via) => Promise.resolve(apply(db, changes, undefined, via)),
  find: () => Promise.resolve([]),
  upload: () => Promise.resolve(),
  touch: () => Promise.resolve(),
  logs: () => Promise.resolve({ entries: [] }),
  history: (eid, limit) => Promise.resolve(journalOf(db, eid, limit)),
  providers: () => Promise.resolve([]),
})

slow(
  'managed Codex runs the production tool chain without credential residue',
  async () => {
    let db = freshDb()
    let tree = await Deno.makeTempDir({ prefix: 'tasks-harness-' })
    let authRoot = await Deno.makeTempDir({ prefix: 'tasks-harness-auth-' })
    let oldToken = 'credential-access-old'
    let newToken = 'credential-access-new'
    let oldAccount = 'credential-account-old'
    let newAccount = 'credential-account-new'
    let authPath = `${authRoot}/auth.json`
    let secrets = [oldToken, newToken, oldAccount, newAccount, authPath]
    let session = uuid(), task = uuid(), other = uuid()
    let comment = uuid(), untouched = uuid()
    let identity = `managed-${uuid()}`
    let marker = `LATER_RELAY_${uuid()}`
    let bodies: Record<string, unknown>[] = []
    let calls = 0
    let priorProbe = Deno.env.get('TASKS_ACCESS_PROBE')
    let priorHome = Deno.env.get('CODEX_HOME')
    Deno.env.set('TASKS_ACCESS_PROBE', oldToken)
    Deno.env.set('CODEX_HOME', authRoot)
    await Deno.writeTextFile(authPath, JSON.stringify({ token: oldToken }))
    try {
      apply(db, [{
        eid: session,
        name: 'session',
        comp: {
          id: identity,
          provider: 'codex',
          model: 'gpt-requested',
          cwd: tree,
        },
      }, {
        eid: task,
        name: 'doc',
        comp: { title: 'Claimed work', body: '' },
      }, {
        eid: task,
        name: 'task',
        comp: { status: 'wip' },
      }, {
        eid: task,
        name: 'claim',
        comp: { session },
      }, {
        eid: other,
        name: 'doc',
        comp: { title: 'Other work', body: '' },
      }, {
        eid: other,
        name: 'task',
        comp: { status: 'open' },
      }, {
        eid: untouched,
        name: 'doc',
        comp: { title: '', body: 'not addressed to this session' },
      }, {
        eid: untouched,
        name: 'comment',
        comp: { target: other },
      }])
      writeSession(db, session, {
        origin: 'managed',
        base_revision: 'base',
      })
      assertEquals(
        db.prepare('select cwd, base_revision from worktree where eid = ?')
          .get(session),
        { cwd: tree, base_revision: 'base' },
      )
      assertEquals(
        db.prepare('select 1 from runtime where eid = ?').get(session),
        undefined,
      )

      let replies = [
        {
          type: 'message',
          id: 'idle-item',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'idle' }],
        },
        {
          type: 'function_call',
          id: 'context-item',
          call_id: 'context-call',
          name: 'task_context',
          arguments: '{}',
        },
        {
          type: 'function_call',
          id: 'shell-item',
          call_id: 'shell-call',
          name: 'shell',
          arguments: JSON.stringify({
            command:
              `printf 'before\\n' > note.txt; printf '%s|%s|%s' "${'$'}{TASKS_ACCESS_PROBE-unset}" "${'$'}{CODEX_HOME-unset}" "$TASKS_SESSION" > env.txt`,
            cwd: null,
            timeout_ms: 10_000,
          }),
        },
        {
          type: 'function_call',
          id: 'patch-item',
          call_id: 'patch-call',
          name: 'apply_patch',
          arguments: JSON.stringify({
            diff:
              '*** Begin Patch\n*** Update File: note.txt\n@@\n-before\n+after\n*** End Patch',
            cwd: null,
            timeout_ms: 10_000,
          }),
        },
        {
          type: 'message',
          id: 'final-item',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'chain complete' }],
        },
      ]
      let refreshed = false
      let transport = responses({
        credentials: {
          get: () =>
            Promise.resolve(
              refreshed
                ? {
                  token: newToken,
                  account: newAccount,
                  base: 'https://provider.invalid/v1',
                }
                : {
                  token: oldToken,
                  account: oldAccount,
                  base: 'https://provider.invalid/v1',
                },
            ),
          refresh: () => {
            refreshed = true
            return Promise.resolve({
              token: newToken,
              account: newAccount,
              base: 'https://provider.invalid/v1',
            })
          },
        },
        retries: 0,
        fetch: (_input, init) => {
          let headers = new Headers(init?.headers)
          let body = JSON.parse(String(init?.body)) as Record<string, unknown>
          bodies.push(body)
          calls++
          if (calls == 1) {
            assertEquals(headers.get('authorization'), `Bearer ${oldToken}`)
            assertEquals(headers.get('chatgpt-account-id'), oldAccount)
            return Promise.resolve(new Response('', { status: 401 }))
          }
          assertEquals(headers.get('authorization'), `Bearer ${newToken}`)
          assertEquals(headers.get('chatgpt-account-id'), newAccount)
          return Promise.resolve(complete(
            replies.shift()!,
            `${oldToken} ${newToken} ${oldAccount} ${newAccount}`,
          ))
        },
      })
      let io = ioFor(db)
      let service = managedCodex({
        db,
        cast: () => {},
        transport,
        tools: async (cwd, sid) => {
          if (!cwd) throw new Error('integration run needs a worktree')
          let identity = String(sessionRow(db, sid)?.id ?? sid)
          return combineTools(
            await localTools({ tree: cwd, session: identity }),
            await tasksTools(io, sid),
          )
        },
        prepare: () => Promise.resolve(),
      })
      await service.start(session, {
        instruction: 'Run the requested context, shell, and patch chain.',
        session_id: identity,
        task: task,
        repo: { path: tree, base_branch: 'main' },
        tree,
        branch: 'session/integration',
        model: 'gpt-requested',
        effort: 'low',
      })
      assertEquals(
        readEntries(db, session).filter((row) =>
          row.comps.message?.role == 'agent'
        ).at(-1)?.comps.content.body,
        'idle',
      )

      apply(db, [{
        eid: comment,
        name: 'doc',
        comp: { title: '', body: marker },
      }, {
        eid: comment,
        name: 'comment',
        comp: { target: task },
      }])
      service.comment(task, comment)
      await service.sweep()

      let entries = readEntries(db, session)
      assertEquals(entries.filter((row) => row.comps.attention).length, 1)
      let attentionInput = JSON.stringify(bodies[2].input)
      assertEquals(attentionInput.includes(attentionPrompt), true)
      assertEquals(attentionInput.includes(marker), false)
      assertMatch(JSON.stringify(bodies[3].input), new RegExp(marker))
      let toolEntries = entries.filter((row) => row.comps.call)
      assertEquals(
        toolEntries.map((row) =>
          row.comps.task_context
            ? 'task_context'
            : row.comps.bash
            ? 'shell'
            : row.comps.patch
            ? 'apply_patch'
            : '?'
        ),
        ['task_context', 'shell', 'apply_patch'],
      )
      let context = entries.find((row) =>
        row.comps.result?.call == toolEntries[0].eid
      )!
      assertMatch(String(context.comps.content.body), /claimed by you/)
      assertMatch(
        String(context.comps.content.body),
        new RegExp(marker),
      )
      assertEquals(
        String(context.comps.content.body).split(marker).length - 1,
        1,
      )
      assertEquals(
        db.prepare('select session from claim where eid = ?').get(task),
        { session },
      )
      assertEquals(
        !!db.prepare('select 1 from notified where eid = ?').get(comment),
        true,
      )
      assertEquals(
        db.prepare('select 1 from notified where eid = ?').get(untouched),
        undefined,
      )
      assertEquals(await Deno.readTextFile(`${tree}/note.txt`), 'after\n')
      assertEquals(
        await Deno.readTextFile(`${tree}/env.txt`),
        `unset|unset|${identity}`,
      )
      assertEquals(
        entries.filter((row) => row.comps.message?.role == 'agent').at(-1)
          ?.comps.content.body,
        'chain complete',
      )
      assertEquals(
        entries.filter((row) => row.comps.generation).at(-1)?.comps.generation
          .serving_model,
        'gpt-served',
      )
      assertEquals(bodies.every((body) => body.store === false), true)
      assertEquals(
        db.prepare('select 1 from runtime where eid = ?').get(session),
        undefined,
      )

      let journal = db.prepare('select batch, via from journal order by rowid')
        .all()
      let surfaces = {
        graph: snapshot(db),
        entries,
        journal,
        providerRequests: bodies,
        session: db.prepare('select * from session where eid = ?').get(session),
        worktree: {
          note: await Deno.readTextFile(`${tree}/note.txt`),
          env: await Deno.readTextFile(`${tree}/env.txt`),
        },
      }
      for (let secret of secrets) {
        let leaked = Object.entries(surfaces).flatMap(([name, value]) =>
          JSON.stringify(value).includes(secret) ? [name] : []
        )
        assertEquals(leaked, [], `leaked ${secret}`)
      }
      assertMatch(JSON.stringify(entries), /\[redacted\]/)
    } finally {
      if (priorProbe == null) Deno.env.delete('TASKS_ACCESS_PROBE')
      else Deno.env.set('TASKS_ACCESS_PROBE', priorProbe)
      if (priorHome == null) Deno.env.delete('CODEX_HOME')
      else Deno.env.set('CODEX_HOME', priorHome)
      db.close()
      await Deno.remove(tree, { recursive: true })
      await Deno.remove(authRoot, { recursive: true })
    }
  },
)

slow(
  'hosted graph_apply lands a dependent Change batch in one atomic write',
  async () => {
    let db = freshDb()
    let session = uuid()
    let identity = `managed-${uuid()}`
    apply(db, [{ eid: session, name: 'session', comp: { id: identity } }])
    let tasks = await tasksTools(ioFor(db), session)
    try {
      // Two dependent component patches on one new entity: the entity is only
      // a well-formed task once BOTH its doc and its task component land. The
      // hosted tool submits them as one Change[] batch, so apply() writes both
      // in a single transaction — the write the single-`change` schema could
      // never express (T-16716).
      let eid = uuid()
      let ok = await tasks.call('graph_apply', {
        changes: [
          { eid, name: 'doc', comp: { title: 'batched' } },
          { eid, name: 'task', comp: { status: 'open' } },
        ],
      })
      assertEquals(ok.failed, false)
      let landed = rows(snapshot(db)).find((row) => row.eid == eid)
      assertEquals(landed?.comps.doc?.title, 'batched')
      assertEquals(landed?.comps.task?.status, 'open')

      // Atomic means both-or-NEITHER: a later change apply() refuses (an
      // unparseable board query fails the whole batch) must roll the earlier
      // doc patch back with it, leaving no half-written entity behind.
      let poisoned = uuid()
      let bad = await tasks.call('graph_apply', {
        changes: [
          { eid: poisoned, name: 'doc', comp: { title: 'never' } },
          { eid: poisoned, name: 'board', comp: { query: '.zzz=1' } },
        ],
      })
      assertEquals(bad.failed, true)
      assertEquals(
        rows(snapshot(db)).find((row) => row.eid == poisoned),
        undefined,
      )
    } finally {
      await tasks.close?.()
      db.close()
    }
  },
)
