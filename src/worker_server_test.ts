// The portable worker lifecycle through the public MCP boundary. Focused
// policy tests own each predicate and race; this file composes one happy path
// through the same stateless JSON-RPC door a Desktop host uses.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow, until } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')

type Rpc = {
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

type Tool = {
  content: { type: string; text?: string }[]
  isError?: boolean
}

let U = ''
let protocol = ''
let seq = 0
let domain = 'worker-canary'
let alone = { sanitizeOps: false, sanitizeResources: false }

let rpc = async (method: string, params: Record<string, unknown>) => {
  let response = await fetch(`http://${U}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  })
  assertEquals(response.status, 200)
  let out = await response.json() as Rpc
  assertEquals(out.error, undefined)
  assert(out.result)
  return out.result
}

let call = async (
  name: string,
  args: Record<string, unknown> = {},
): Promise<Tool> =>
  await rpc('tools/call', { name, arguments: args }) as unknown as Tool

let text = (out: Tool) =>
  out.content.filter((c) => c.type == 'text').map((c) => c.text ?? '').join(
    '\n',
  )

let ok = async (name: string, args: Record<string, unknown> = {}) => {
  let out = await call(name, args)
  assertEquals(out.isError, undefined, `${name}: ${text(out)}`)
  return text(out)
}

let json = async <T>(name: string, args: Record<string, unknown> = {}) => {
  let out = await call(name, args)
  assertEquals(out.isError, undefined, `${name}: ${text(out)}`)
  let body = out.content.find((c) => c.type == 'text')?.text
  assert(body)
  return JSON.parse(body) as T
}

let identity = (body: string) => {
  let session = body.match(/^session: (S-\d+)$/m)?.[1]
  let sid = body.match(/^sid: ([^\n]+)$/m)?.[1]
  assert(session && sid)
  return { session, sid }
}

if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  let mcp = await import('./mcp.ts')
  protocol = mcp.WORKER_PROTOCOL
  await import('./server.ts')
  U = `127.0.0.1:${port}`
}

slow(
  'public MCP composes the portable worker lifecycle',
  alone,
  async () => {
    let initialized = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'desktop-canary', version: '1' },
    })
    assertEquals(initialized.protocolVersion, '2025-03-26')
    assertEquals(
      (initialized.serverInfo as { name: string }).name,
      'tasks',
    )
    assert(String(initialized.instructions).includes(protocol))

    let started = await ok('work_start')
    let builder = identity(started)
    assertMatch(started, /^state: created$/m)
    let resumed = await ok('work_start', { session: builder.sid })
    assertEquals(identity(resumed), builder)
    assertMatch(resumed, /^state: resumed$/m)

    let fixture = await json<{ aliases: Record<string, string> }>(
      'graph_apply',
      {
        entities: [
          {
            key: 'project',
            comps: {
              doc: { title: 'Worker canary' },
              project: {},
              noverify: {},
            },
          },
          {
            key: 'prerequisite',
            comps: {
              doc: { title: 'Settled prerequisite', body: '' },
              task: { project: 'project', domain },
              completed: {},
            },
          },
          {
            key: 'target',
            comps: {
              doc: { title: 'Executable proposal', body: 'draft' },
              task: { project: 'project', domain, priority: 1 },
              proposed: { at: '2026-01-01T00:00:00.000Z' },
            },
          },
          {
            key: 'design',
            comps: {
              doc: {
                title: 'Worker canary design',
                body: 'Use graph-only work.',
              },
              design: {},
              task: { project: 'project', domain, priority: 1 },
              proposed: { at: '2026-01-02T00:00:00.000Z' },
            },
            deps: { about: 'target' },
          },
        ],
        session: builder.sid,
      },
    )
    assertEquals(
      Object.keys(fixture.aliases).sort(),
      ['design', 'prerequisite', 'project', 'target'],
    )
    let human = async (key: string, kind: string, prefix: string) => {
      let row = await json<{
        kind: string
        entity: { eid: string; num: number }
      }>('task_show', {
        id: fixture.aliases[key],
        session: builder.sid,
      })
      assertEquals(row.kind, kind)
      assertEquals(row.entity.eid, fixture.aliases[key])
      return `${prefix}-${row.entity.num}`
    }
    let projectId = await human('project', 'project', 'P')
    let prerequisiteId = await human('prerequisite', 'task', 'T')
    let targetId = await human('target', 'task', 'T')
    let designId = await human('design', 'design', 'D')
    let syntheticProject = await json<Record<string, unknown>>('task_show', {
      id: projectId,
      session: builder.sid,
    })
    assert(syntheticProject.project && syntheticProject.noverify)
    assertEquals(syntheticProject.repo, undefined)

    let filters = [`.project=${projectId}`, `.domain=${domain}`]
    let evaluating = await json<{ id: string; decision: string }[]>(
      'work_list',
      { lane: 'evaluate', filters },
    )
    assertEquals(evaluating.map((c) => c.id), [designId, targetId])
    assert(evaluating.every((c) => c.decision == 'pending'))

    let proposedDesign = await json<Record<string, unknown>>('task_show', {
      id: designId,
      session: builder.sid,
    })
    assert(proposedDesign.design && proposedDesign.proposed)
    assertEquals(
      (proposedDesign.doc as { body: string }).body,
      'Use graph-only work.',
    )
    assertEquals(
      (proposedDesign.refs as { type: string; child: string }[]).find((r) =>
        r.type == 'about'
      )?.child,
      targetId,
    )
    assertEquals(proposedDesign.decided, undefined)
    await ok('task_update', {
      id: designId,
      params: ['.decided.at=now'],
      session: builder.sid,
    })
    let approvedDesign = await json<Record<string, unknown>>('task_show', {
      id: designId,
      session: builder.sid,
    })
    assert(approvedDesign.proposed && approvedDesign.decided)

    let proposal = await json<Record<string, unknown>>('task_show', {
      id: targetId,
      session: builder.sid,
    })
    assert(proposal.proposed)
    assertEquals((proposal.doc as { body: string }).body, 'draft')
    assertEquals(proposal.decided, undefined)
    assertEquals(
      await json<unknown[]>('work_list', { lane: 'build', filters }),
      [],
    )

    let spec = 'Write the durable graph-only canary artifact.'
    let accept = 'The task body ends with artifact: ready.'
    await ok('task_update', {
      id: targetId,
      params: [`.body=${spec}`, `.accept.body=${accept}`],
      session: builder.sid,
    })
    await ok('graph_apply', {
      changes: [
        {
          eid: targetId,
          name: 'dependency',
          comp: { type: 'requires', child: prerequisiteId },
        },
        {
          eid: targetId,
          name: 'dependency',
          comp: { type: 'reads', child: designId },
        },
      ],
      session: builder.sid,
    })
    let enriched = await json<Record<string, unknown>>('task_show', {
      id: targetId,
      session: builder.sid,
    })
    assertEquals((enriched.doc as { body: string }).body, spec)
    assertEquals((enriched.accept as { body: string }).body, accept)
    assertEquals(
      (enriched.refs as { type: string; child: string }[])
        .filter((r) => ['reads', 'requires'].includes(r.type)),
      [
        { type: 'reads', child: designId },
        { type: 'requires', child: prerequisiteId },
      ],
    )

    await ok('task_claim', {
      id: targetId,
      session: builder.sid,
      approve: true,
    })
    let claimed = await json<Record<string, unknown>>('task_show', {
      id: targetId,
      session: builder.sid,
    })
    assert(claimed.proposed && claimed.decided && claimed.claim)

    let rival = identity(await ok('work_start'))
    let lost = await call('task_claim', {
      id: targetId,
      session: rival.sid,
    })
    assertEquals(lost.isError, true)
    assertMatch(text(lost), new RegExp(`${targetId} already claimed`))
    let conflicts = await json<{
      kind: string
      conflict: { target: string; loser: string; holder: string }
    }[]>('graph_query', {
      filters: ['.kind=conflict', `.conflict.target=${targetId}`],
      full: true,
    })
    assertEquals(conflicts.length, 1)
    assertEquals(conflicts[0].kind, 'conflict')
    // The audit names each side by its session ENTITY, not its sid label.
    let sessionEid = async (id: string) =>
      (await json<{ entity: { eid: string } }>('task_show', { id })).entity.eid
    assertEquals(conflicts[0].conflict.loser, await sessionEid(rival.session))
    assertEquals(
      conflicts[0].conflict.holder,
      await sessionEid(builder.session),
    )

    let trail = [
      'progress: inspected design, acceptance, and dependencies',
      'failure: artifact absent; expected artifact: ready; retrying',
      'resolution: graph-only artifact written',
    ]
    for (let body of trail) {
      await ok('task_comment', { id: targetId, body, session: builder.sid })
    }
    await ok('task_update', {
      id: targetId,
      params: [`.body=${spec}\n\nartifact: ready`],
      session: builder.sid,
    })
    let completion =
      'completed: graph-only artifact and lifecycle evidence landed'
    await ok('task_update', {
      id: targetId,
      params: ['.status=done'],
      comment: completion,
      session: builder.sid,
    })
    let completionState = await json<Record<string, unknown>>('task_show', {
      id: targetId,
      session: builder.sid,
    })
    let batchedComment = (
      completionState.comments as Record<string, unknown>[]
    ).find((c) => (c.doc as { body: string }).body == completion)
    assert(batchedComment)
    let commentId = `C-${(batchedComment.entity as { num: number }).num}`
    let taskHistory = await ok('history', {
      id: targetId,
      limit: 1,
      session: builder.sid,
    })
    let commentHistory = await ok('history', {
      id: commentId,
      limit: 3,
      session: builder.sid,
    })
    let batch = (body: string, changed: RegExp) => {
      let line = body.split('\n').find((line) => changed.test(line))
      let id = line?.match(/^#(\d+)/)?.[1]
      assert(id)
      return id
    }
    assertMatch(taskHistory, /completed/)
    assertMatch(commentHistory, /comment/)
    assertEquals(
      batch(taskHistory, /completed/),
      batch(commentHistory, /comment/),
    )
    await ok('task_release', { id: targetId, session: builder.sid })

    let completed = await json<Record<string, unknown>>('task_show', {
      id: targetId,
      session: rival.sid,
    })
    assert(completed.proposed && completed.decided && completed.completed)
    assertEquals(completed.claim, undefined)
    assertEquals(
      (completed.doc as { body: string }).body,
      `${spec}\n\nartifact: ready`,
    )
    let completedAt = String((completed.completed as { at: string }).at)
    await until(() => Date.now() > Date.parse(completedAt), {
      label: 'the review clock to pass completion',
    })

    let verifying = await json<{ id: string; accept: { body: string } }[]>(
      'work_list',
      { lane: 'verify', filters },
    )
    assertEquals(verifying.map((c) => c.id), [targetId])
    assertEquals(verifying[0].accept.body, accept)
    await ok('task_show', { id: targetId, session: rival.sid })
    let evidence = 'approved: artifact, lifecycle states, and release verified'
    await ok('task_comment', {
      id: targetId,
      body: evidence,
      verdict: 'approved',
      session: rival.sid,
    })

    let final = await json<Record<string, unknown>>('task_show', {
      id: targetId,
      session: rival.sid,
    })
    assert(final.proposed && final.decided && final.completed)
    assertEquals(final.claim, undefined)
    assertEquals(final.spawn, undefined)
    assertEquals(final.repo, undefined)
    let reviews = (final.comments as Record<string, unknown>[]).filter((c) =>
      c.kind == 'review'
    )
    assertEquals(reviews.length, 1)
    assertEquals((reviews[0].doc as { body: string }).body, evidence)
    let trailRows = (final.comments as Record<string, unknown>[]).filter((c) =>
      c.kind == 'comment' &&
      trail.includes((c.doc as { body: string }).body)
    )
    assertEquals(trailRows.length, trail.length)
    let completionRows = (final.comments as Record<string, unknown>[]).filter(
      (c) => (c.doc as { body: string }).body == completion,
    )
    assertEquals(completionRows.length, 1)
    assert(
      Date.parse((reviews[0].created as { at: string }).at) >
        Date.parse(completedAt),
    )
    assertEquals(
      await json<unknown[]>('work_list', { lane: 'verify', filters }),
      [],
    )

    let sessions = await json<{
      kind: string
      entity: { eid: string; num: number }
      session: {
        id: string
        provider?: string | null
        model?: string | null
        cwd?: string | null
      }
      spawn?: { provider?: string | null; model?: string | null }
    }[]>(
      'graph_query',
      { filters: ['.kind=session'], full: true },
    )
    assertEquals(sessions.length, 2)
    assert(
      sessions.every((s) =>
        !s.session.provider && !s.session.model && !s.session.cwd &&
        !s.spawn?.provider && !s.spawn?.model
      ),
    )
    let correlate = (who: { session: string; sid: string }) => {
      let row = sessions.find((s) => s.session.id == who.sid)
      assert(row)
      assertEquals(row.kind, 'session')
      assertEquals(`S-${row.entity.num}`, who.session)
      return row.entity.eid
    }
    let builderEid = correlate(builder)
    let rivalEid = correlate(rival)
    assert(
      trailRows.every((c) => (c.created as { via: string }).via == builderEid),
    )
    let completionRow = completionRows[0]
    assertEquals(
      (completionRow.created as { via: string }).via,
      builderEid,
    )
    assertEquals((final.completed as { via: string }).via, builderEid)
    assertEquals(
      (reviews[0].created as { via: string }).via,
      rivalEid,
    )
    assertEquals(
      await json<unknown[]>('graph_query', {
        filters: ['.spawn.provider!'],
        full: true,
      }),
      [],
    )
    assertEquals(
      await json<unknown[]>('graph_query', {
        filters: ['.spawn.model!'],
        full: true,
      }),
      [],
    )
    assertEquals(
      await json<unknown[]>('graph_query', {
        filters: ['.session.cwd!'],
        full: true,
      }),
      [],
    )
    assertEquals(
      await json<unknown[]>('graph_query', {
        filters: ['.repo!'],
        full: true,
      }),
      [],
    )
    assertEquals(
      await json<unknown[]>('graph_query', {
        filters: ['.verifier!'],
        full: true,
      }),
      [],
    )
  },
)
