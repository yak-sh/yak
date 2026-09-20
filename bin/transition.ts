#!/usr/bin/env -S deno run -A
// ONE-TIME USE. This file is deleted at cutover (T-37584) along with `src/`.
//
// The fleet server is dismantled, not migrated (D-37573, C#9faadb22f2): its
// database is exported ONCE into the package vocabulary and imported into a
// fresh db that `yak serve` opens with the plugins in `etc/yak.json`. Every
// adapter the fleet's shape needs lives HERE and nowhere else — no package
// carries a column, a keyword or a branch for the fleet's sake.
//
// `docs/transition.md` is the spec: one row per fleet component, naming the
// package component its rows become or why nothing takes them. This script
// reads that table at run time and refuses to finish if a fleet component has
// neither a move of its own nor a drop row in the doc, so the two cannot drift.
//
//   deno run -A bin/transition.ts --from ~/.tasks/snap.db --to /tmp/yak.db
//
// `--from` must be a COPY (`VACUUM INTO`), never the live file. `--limit N`
// caps each component table for a quick pass over the shape.

import { Database } from '@yaks/sqlite/db'
import { mintSql } from '@yaks/sqlite'
import { compose, type Module, read } from '@yaks/cli/serve'
import type { Bundle, Eid } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { aliasEid } from '@yaks/alias'
import { derivedEid } from '@yaks/graph'

// ─── the fleet side ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>

/** The fleet's own reading of an entity: the eid it is called by, and the
 * human number it wears (or none). */
type Spine = { eid: string; num: number | null }

let text = (v: unknown): string | undefined => v == null ? undefined : String(v)
let num = (v: unknown): number | undefined => v == null ? undefined : Number(v)
let bool = (v: unknown): boolean | undefined =>
  v == null ? undefined : !!Number(v)

/** Everything one conversion needs to say what a row means. */
type Ctx = {
  /** the eid a fleet integer id names, after any re-identification */
  ref: (id: unknown) => string | undefined
  /** the entity a tool of this name is, minting one the first time */
  tool: (name: string) => string
  /** the entity a model of this name is */
  model: (name: string) => string | undefined
  /** the entity a provider of this name is */
  provider: (name: string) => string | undefined
  /** the entity a repository at this path or url is */
  repository: (name: string) => string
  /** the git ref a branch NAME is — @yaks/git's `worktree.branch` points at
   * the ref, it does not spell it */
  branch: (name: string) => string
  /** the first entry of a session, when it has one */
  firstEntry: (session: string) => string | undefined
  /** the prose an artifact entity holds */
  body: (id: unknown) => string | undefined
  /** an extra bundle, for a row that says more than one thing */
  also: (b: Bundle) => void
  /** a column this conversion could not carry, counted by name */
  lost: (column: string) => void
}

/** What a fleet component's row becomes: the package component's patch, or
 * nothing when this particular row says nothing (the fact moved onto another
 * entity through `also`). */
type Move = {
  /** the package component its rows become, as docs/transition.md names it */
  says: string
  /** the eid the patch lands on, when it is not the row's own entity */
  onto?: (row: Row, ctx: Ctx) => string | undefined
  make: (row: Row, ctx: Ctx) => Record<string, unknown> | null
  /** set where this component's rows arrive by some route other than the loop
   * — the spine pass, or a plugin that derives them — and say which. Its table
   * is then not walked, and the count is reported under that reason rather
   * than as a loss. */
  elsewhere?: string
}

// The marks: at/by/via as the fleet stamped them, carried as trusted writes so
// the new graph records WHEN a thing happened rather than when it was imported.
let mark = (row: Row, ctx: Ctx) => ({
  ...(row.at == null ? {} : { at: String(row.at) }),
  ...(row.by == null ? {} : { by: ctx.ref(row.by) }),
  ...(row.via == null ? {} : { via: ctx.ref(row.via) }),
})

let same = (says: string, ...cols: string[]): Move => ({
  says,
  make: (row, ctx) => {
    let out: Record<string, unknown> = {}
    for (let c of cols) {
      let v = row[c]
      if (v == null) continue
      out[c] = v
    }
    void ctx
    return out
  },
})

let tag = (says: string): Move => ({ says, make: () => ({}) })

let marked = (says: string): Move => ({ says, make: mark })

// A row whose columns are entity references as well as scalars.
let refs = (says: string, ref: string[], plain: string[] = []): Move => ({
  says,
  make: (row, ctx) => {
    let out: Record<string, unknown> = {}
    for (let c of ref) if (row[c] != null) out[c] = ctx.ref(row[c])
    for (let c of plain) if (row[c] != null) out[c] = row[c]
    return out
  },
})

// The eleven typed facets the fleet grew per tool name, and the `tool_use`
// block beside them: all of it is one `call{to, args}`. The tool is named by
// `tool_use.name` where the transcript kept it and by the facet's own word
// where it did not, and the facet's columns ARE the arguments.
let asCall = (facet: string, ...cols: string[]): Move => ({
  says: 'call',
  make: (row, ctx) => {
    let args: Record<string, unknown> = {}
    for (let c of cols) if (row[c] != null) args[c] = row[c]
    return {
      to: ctx.tool(String(row.$tool ?? facet)),
      args: JSON.stringify(args),
    }
  },
})

/**
 * THE TABLE, as code: one entry per fleet component, `null` where nothing
 * takes its rows. It is checked against `docs/transition.md` before anything
 * is written — a component the doc moves and this does not is a refusal, not a
 * silent loss.
 */
let MOVES: Record<string, Move | null> = {
  // ── kernel: the spine and its marks ──
  about: tag('about'),
  alias: {
    says: 'alias',
    // The name IS the row: @yaks/alias writes one through the `alias{name}`
    // sugar on the named entity's own bundle, and every OTHER name the fleet
    // listed beside it is another key on that same entity.
    make: (row, ctx) => {
      for (let extra of String(row.slugs ?? '').split(/\s+/).filter(Boolean)) {
        ctx.also({
          entity: { eid: aliasEid(extra), num: null },
          key: { of: ctx.ref(row.entity), value: extra },
          alias: {},
        })
      }
      return row.slug == null ? null : { name: String(row.slug) }
    },
  },
  anchor: same('anchor', 'paths', 'sha', 'symbol', 'hunk', 'start', 'end'),
  archetype: {
    says: 'archetype',
    // A descriptor names the TABLES an entity wears, and the tables change
    // here — so it is re-derived by @yaks/archetype as each entity is written,
    // never copied from a reading of a schema that is being dismantled.
    elsewhere: 're-derived by @yaks/archetype as each entity lands',
    make: () => null,
  },
  archived: marked('archived'),
  artifact: {
    says: 'artifact',
    // The fleet kept its blob store on the spine, one entity per SHA. The
    // package's store is off it — but the journal's rows point AT these
    // entities, so the descriptors come across and the bytes land again
    // underneath through @yaks/blob when each body is written.
    make: (row, ctx) => ({ size: num(row.size), address: ctx.ref(row.entity) }),
  },
  attachment: refs('attachment', ['artifact'], ['media_type', 'name']),
  attention: tag('attention'),
  comment: refs('comment', ['target']),
  commit: {
    says: 'commit',
    // The sha IS the eid (see `reidentified`), so the column is gone, and
    // `repo` names a repository entity rather than spelling a path.
    make: (row, ctx) => ({
      ...(row.target == null ? {} : { target: ctx.ref(row.target) }),
      ...(row.repo == null ? {} : { repo: ctx.repository(String(row.repo)) }),
      ...(row.message == null ? {} : { message: String(row.message) }),
    }),
  },
  contains: tag('contains'),
  created: marked('created'),
  decided: {
    says: 'decided',
    make: (row, ctx) => ({ ...mark(row, ctx), verdict: text(row.verdict) }),
  },
  delegates: tag('delegates'),
  doc: {
    says: 'doc',
    // The fleet's `body` is a pointer into its blob store; the package's is
    // the prose, and @yaks/blob addresses it again on the way in.
    make: (row, ctx) => ({
      title: String(row.title ?? ''),
      body: ctx.body(row.body) ?? '',
    }),
  },
  edge: {
    says: 'edge',
    // An edge is one sentence, so it is written as one bundle: `edge{from,
    // to}` and the relation tag together. Said apart, the half without a tag
    // is not an edge yet — @yaks/edge refuses it, and rightly.
    elsewhere: 'written with the relation tag it wears, in one bundle',
    make: () => null,
  },
  effect: {
    says: 'effect',
    make: (row) => ({
      handler: text(row.handler),
      state: row.state == 'leased'
        ? 'pending'
        : row.state == 'delivered'
        ? 'done'
        : text(row.state),
      attempts: num(row.attempts),
      lease_owner: text(row.lease_owner),
      lease_token: text(row.lease_token),
      lease_expiry: text(row.lease_expiry),
    }),
  },
  entity: {
    says: 'entity',
    // The spine itself: every eid and the number it wears go in FIRST, before
    // anything can reference one, because a reference mints the spine it names
    // and the first mint is the one that decides the number.
    elsewhere: 'the spine pass, before any reference can mint one',
    make: () => null,
  },
  exception: same(
    'exception',
    'at',
    'message',
    'stack',
    'request',
    'version',
  ),
  favorite: {
    says: 'favorite',
    make: (row) => ({ at: text(row.at) }),
  },
  image: same('image', 'w', 'h'),
  meta: tag('meta'),
  notified: marked('notified'),
  opened: marked('opened'),
  proposed: marked('proposed'),
  quarantined: marked('quarantined'),
  reads: tag('reads'),
  recall: same('recall', 'count', 'first_at', 'last_at'),
  redaction: {
    says: 'redaction',
    make: (row, ctx) => ({
      target: ctx.ref(row.target),
      column: text(row.column),
      hash: text(row.hash),
    }),
  },
  references: tag('references'),
  requires: tag('requires'),
  retired: tag('retired'),
  satisfies: tag('satisfies'),
  setting: null, // a plugin reads its config from its config
  signal: null, // the fleet's timer bus; a reminder is @yaks/wake `wake`
  supersedes: tag('supersedes'),
  supervises: tag('supervises'),
  updated: marked('updated'),
  wants: tag('wants'),
  worked: tag('worked'),

  // ── work ──
  accept: same('accept', 'body'),
  architecture: tag('architecture'),
  blocked: {
    says: 'blocked',
    make: (row) => ({ on: text(row.on), since: text(row.since) }),
  },
  board: {
    says: 'board',
    // A board IS its query, so a saved query is a stored VALUE and a rename is
    // a rename: `.status` meant a task's status when a task was the only thing
    // that had one, and now a session has one too, so the saved word is
    // rewritten rather than left to be refused at read time.
    make: (row, ctx) => {
      let q = String(row.query ?? '')
      let said = q.replace(/(^|[&|(\s])\.status\b/g, '$1.task.status')
      if (said != q) ctx.lost('board.query (.status → .task.status)')
      return { query: said }
    },
  },
  cancelled: {
    says: 'cancelled',
    make: (row, ctx) => ({ ...mark(row, ctx), reason: text(row.reason) }),
  },
  completed: marked('completed'),
  design: tag('design'),
  filed: refs('filed', ['project', 'assignee'], ['priority', 'domain']),
  goal: refs('goal', ['scope']),
  project: same('project', 'color'),
  repo: {
    says: 'repo',
    // A project's landing policy, not a second git record: the path is a
    // worktree OF the repository the url names.
    make: (row, ctx) => {
      let repository = ctx.repository(String(row.url || row.path))
      if (row.path) {
        ctx.also({
          entity: { eid: derivedEid(`worktree|${row.path}`), num: null },
          worktree: { repository, path: String(row.path) },
        })
      }
      return {
        repository,
        base_branch: text(row.base_branch),
        gate: text(row.gate),
        push: bool(row.push),
      }
    },
  },
  review: same('review', 'verdict'),
  task: tag('task'),
  venture: {
    says: 'venture',
    // `paused` is a MARK beside the phase, so nothing has to be remembered
    // and put back; a cadence, a model and an operator are not free text on a
    // business, so each becomes the thing it names or is left behind.
    make: (row, ctx) => {
      let phase = String(row.phase ?? '')
      let held = phase == 'paused' || phase == 'hold'
      if (held) ctx.also({ entity: { eid: ctx.ref(row.entity)! }, paused: {} })
      let model = row.agent_model
        ? ctx.model(String(row.agent_model))
        : undefined
      if (model) ctx.also(link(ctx.ref(row.entity)!, 'references', model))
      if (row.run_mode) ctx.lost('venture.run_mode')
      if (row.operated_by) ctx.lost('venture.operated_by')
      return {
        phase: held
          ? text(row.paused_from ?? row.hold_from) ?? 'building'
          : phase,
        tagline: text(row.tagline),
        site: text(row.site),
      }
    },
  },

  // ── identity ──
  feedback: refs('feedback', ['by']),
  memory: refs('memory', ['scope'], ['last_confirmed_at']),
  model: refs(
    'model',
    ['provider'],
    ['name', 'vendor', 'grade', 'label', 'efforts', 'effort', 'offered'],
  ),
  person: tag('person'),
  persona: refs('persona', ['home']),
  provider: refs(
    'provider',
    ['serves'],
    ['name', 'transport', 'credential', 'fallback', 'offered'],
  ),

  // ── roles: what is left of a job is what a job IS ──
  bug: null,
  dream: refs('dream', ['scope'], ['floor']),
  finding: null,
  fixer: null,
  nofix: null,
  noverify: null,
  role: {
    says: 'role',
    make: (row, ctx) => {
      for (
        let col of [
          'schedule',
          'wake_policy',
          'wake_target',
          'retry_at',
          'quiet',
          'cooldown',
          'cap',
          'applied_hash',
          'applied_at',
          'decision',
          'reason',
          'observed',
          'decided_at',
        ]
      ) if (row[col] != null) ctx.lost(`role.${col}`)
      if (row.checkout != null) {
        ctx.also(
          link(ctx.ref(row.entity)!, 'references', ctx.ref(row.checkout)!),
        )
      }
      return {
        state: text(row.state),
        surface: text(row.surface),
        scope: ctx.ref(row.scope),
        stopped_at: text(row.stopped_at),
      }
    },
  },
  verifier: null,

  // ── comms ──
  deliver: refs('deliver', ['to']),
  delivered: {
    says: 'delivered',
    make: (row) => ({ at: text(row.at), via: text(row.via) }),
  },
  failed: {
    says: 'bounced',
    // One fact, not two: a letter either left or it did not.
    make: (row) => ({ at: text(row.at), reason: text(row.message) }),
  },
  knock: refs('knock', ['target']),
  subscription: refs('subscription', ['actor', 'target'], ['mode']),
  wake: refs('wake', ['target'], ['at', 'note']),

  // ── mail ──
  email: same('email', 'address'),
  hook: {
    says: 'hook',
    // `spool_id` was delivery-file bookkeeping; `received_at` is the kernel's
    // `created.at`; a checked signature is `verified`, the word the rest of
    // the mail vocabulary already uses.
    make: (row, ctx) => {
      if (row.received_at != null) {
        ctx.also({
          entity: { eid: ctx.ref(row.entity)! },
          created: { at: String(row.received_at) },
        })
      }
      return {
        source: text(row.source),
        event: text(row.event),
        payload: text(row.payload),
        method: text(row.method),
        path: text(row.path),
        headers: text(row.headers),
        verified: bool(row.sig_ok),
      }
    },
  },
  mail: {
    says: 'mail',
    make: (row, ctx) => {
      if (row.headers != null) ctx.lost('mail.headers')
      return {
        from: text(row['from']),
        to: text(row.to_addr),
        at: text(row.received_at),
        target: ctx.ref(row.target),
        reply_to: ctx.ref(row.reply_to),
        message_id: text(row.message_id),
        in_reply_to: text(row.in_reply_to),
        sent_id: text(row.sent_id),
        verified: bool(row.verified),
      }
    },
  },

  // ── capture ──
  web: same('web', 'url', 'frozen_at'),

  // ── process ──
  process: same('process', 'pid', 'command', 'cwd'),
  service: same('service', 'command', 'cwd', 'restart', 'attempts'),
  stop: tag('stop'),

  // ── platform ──
  app: refs('app', ['space'], ['slug', 'version', 'access']),
  deploy: refs('deploy', ['app'], ['version', 'files', 'worker']),
  hostname: refs('hostname', ['app'], ['name', 'stage', 'at']),
  installed: refs('installed', ['of'], ['version']),
  member: {
    says: 'member',
    // Belonging and authority are two facts, not one enum.
    make: (row, ctx) => {
      let person = ctx.ref(row.person)
      let role = String(row.role ?? 'viewer')
      if (role != 'owner' && person) {
        ctx.also({
          entity: {
            eid: derivedEid(`grant|${row.space}|${row.person}`),
            num: null,
          },
          grant: { app: ctx.ref(row.space), person, access: role },
        })
      }
      return {
        space: ctx.ref(row.space),
        person,
        role: role == 'owner' ? 'owner' : 'member',
      }
    },
  },
  meter: same(
    'meter',
    'month',
    'requests',
    'rows_read',
    'rows_written',
    'bytes',
    'emails',
    'builds',
    'tokens',
    'seconds',
    'built',
    'at',
  ),
  plan: same(
    'plan',
    'tier',
    'customer',
    'subscription',
    'status',
    'until',
    'ending',
    'at',
  ),
  published: same('published', 'name', 'version', 'at', 'about'),
  report: refs('report', ['app', 'space'], ['version', 'release', 'at']),
  signin: same('signin', 'email', 'code', 'expires', 'tries'),
  space: refs('space', ['home'], ['slug']),

  // ── canvas ──
  camera: refs('camera', ['client', 'canvas'], ['x', 'y', 'zoom', 'w', 'h']),
  canvas: tag('canvas'),
  card: refs('card', ['target'], ['view']),
  client: refs('client', ['actor'], ['user_agent', 'ip']),
  cursor: refs('cursor', ['client', 'target'], ['view']),
  fold: refs('fold', ['client', 'board'], ['statuses']),
  layout: refs('layout', ['root']),
  pane: refs(
    'pane',
    ['layout', 'parent', 'content'],
    ['size', 'order', 'dir', 'view'],
  ),
  pin: refs('pin', ['canvas'], ['x', 'y', 'w', 'h', 'z']),
  shelf: refs('shelf', ['client']),

  // ── sessions: the whole of what a run was said six ways ──
  apply: asCall('apply', 'changes'),
  bash: asCall('bash', 'command', 'cwd'),
  brief: same('brief', 'text'),
  call: {
    says: 'call',
    // The fleet's `call` carried the provider's key; the tool and the
    // arguments come from the facet beside it, which the join supplies.
    make: (row, ctx) => ({
      id: text(row.key),
      to: ctx.tool(String(row.$tool ?? 'call')),
    }),
  },
  cancel: refs('cancel', ['target']),
  chat: refs('chat', ['actor', 'target']),
  checkpoint: refs('checkpoint', ['through']),
  claim: {
    says: 'claim',
    make: (row, ctx) => ({ session: ctx.ref(row.session), at: text(row.at) }),
  },
  conflict: {
    says: 'conflict',
    make: (row, ctx) => ({
      target: ctx.ref(row.target),
      loser: ctx.ref(row.loser),
      holder: ctx.ref(row.holder),
      at: text(row.at),
    }),
  },
  content: {
    says: 'content',
    make: (row, ctx) => {
      if (row.source != null) {
        ctx.also({
          entity: { eid: ctx.ref(row.entity)! },
          output: { source: ctx.ref(row.source) },
        })
      }
      return { body: String(row.body ?? '') }
    },
  },
  entry: {
    says: 'entry',
    make: (row, ctx) => ({ session: ctx.ref(row.session), seq: num(row.seq) }),
  },
  exit: same('exit', 'code'),
  fetch: asCall('fetch', 'url', 'method'),
  fork: refs('fork', ['from']),
  generation: {
    says: 'ask',
    // One ask, not a second row about it: what ANSWERED is the `using`
    // stamped on the ask, so `serving_model` is `using.model` there.
    make: (row, ctx) => {
      let provider = row.provider && ctx.provider(String(row.provider))
      let asked = row.model && ctx.model(String(row.model))
      let served = row.serving_model && ctx.model(String(row.serving_model))
      ctx.also({
        entity: { eid: ctx.ref(row.entity)! },
        using: {
          ...(provider ? { provider } : {}),
          ...(served ?? asked ? { model: served ?? asked } : {}),
          ...(row.effort == null ? {} : { effort: String(row.effort) }),
        },
      })
      return {
        through: ctx.ref(row.through),
        ...(served ?? asked ? { to: served ?? asked } : {}),
      }
    },
  },
  graph_query: asCall('graph_query', 'query'),
  headers: asCall('headers', 'data'),
  imported: same('imported', 'source', 'line'),
  lease: {
    says: 'effect',
    // A run holds its own lease — these are columns of the effect run, not a
    // row about a runner.
    make: (row, ctx) => ({
      lease_owner: ctx.ref(row.holder),
      lease_expiry: text(row.until),
      at: text(row.at),
    }),
  },
  message: {
    says: 'content',
    // Prose says its own side: `content` alone is an input, `content` beside
    // `output{source}` is what a model said.
    make: (row, ctx) => {
      // Wearing `output` at all is the side it is on; WHICH ask produced it is
      // `output.source`, which the fleet's own `output` row says where it knew
      // one — so this writes the side and never guesses the source.
      if (row.role == 'agent') {
        ctx.also({ entity: { eid: ctx.ref(row.entity)! }, output: {} })
      }
      return null
    },
  },
  opaque: asCall('opaque', 'format', 'data'),
  output: {
    says: 'output',
    make: (row, ctx) => ({
      source: ctx.ref(row.source),
      id: text(row.key),
      phase: text(row.phase),
    }),
  },
  patch: asCall('patch', 'path', 'diff'),
  prompt: tag('prompt'),
  reasoning: tag('reasoning'),
  recalled: refs('recalled', ['source'], ['at']),
  response: asCall('response', 'status'),
  result: {
    says: 'result',
    make: (row, ctx) => ({ call: ctx.ref(row.call), ms: num(row.ms) }),
  },
  resume: refs('resume', ['actor'], ['at', 'rank']),
  run: {
    says: 'session',
    // Dropped as state: a transcript's status is read off its entries, and
    // every time on it is the moment of some entry.
    make: (_row, ctx) => {
      ctx.lost('run.*')
      return null
    },
  },
  runner: {
    says: 'process',
    make: (row) => ({ command: text(row.name) }),
  },
  runtime: {
    says: 'process',
    make: (row, ctx) => {
      if (row.pane != null) ctx.lost('runtime.pane') // TODO @yaks/tmux
      if (row.transcript != null) ctx.lost('runtime.transcript')
      if (row.provider_session_id != null) {
        ctx.also({
          entity: { eid: ctx.ref(row.entity)! },
          openai: { response_id: String(row.provider_session_id) },
        })
      }
      let served = row.serving_model && ctx.model(String(row.serving_model))
      if (served) {
        ctx.also({
          entity: { eid: ctx.ref(row.entity)! },
          using: { model: served },
        })
      }
      return row.pid == null ? null : { pid: num(row.pid) }
    },
  },
  session: {
    says: 'session',
    // IDENTITY ONLY. Everything else is derived, is somebody else's word, or
    // rides on the first entry — see the `session` row of docs/transition.md.
    make: (row, ctx) => {
      let me = ctx.ref(row.entity)!
      let first = ctx.firstEntry(me) ?? me
      let provider = row.provider && ctx.provider(String(row.provider))
      let model = row.model && ctx.model(String(row.model))
      if (provider || model || row.effort != null) {
        ctx.also({
          entity: { eid: first },
          using: {
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(row.effort == null ? {} : { effort: String(row.effort) }),
          },
        })
      }
      if (row.parent != null) {
        ctx.also({
          entity: { eid: me },
          spawned: { parent: ctx.ref(row.parent) },
        })
      }
      // What the session was asked to work on. It is the CLAIM only while the
      // session still holds one — the fleet's own `claim` rows say which, and
      // there are two of them. Five thousand finished sessions each writing a
      // lease would read as five thousand tasks in progress, which is not what
      // an archive says: a finished session's request is what it WORKED on.
      let want = ctx.ref(row.requested_task)
      if (want) ctx.also(link(me, 'worked', want))
      for (let col of ['persona', 'role']) {
        let to = row[col] != null && ctx.ref(row[col])
        if (to) ctx.also(link(me, 'references', to))
      }
      if (row.cwd != null) {
        ctx.also({
          entity: { eid: me },
          worktree: {
            path: String(row.cwd),
            ...(row.branch == null
              ? {}
              : { branch: ctx.branch(String(row.branch)) }),
            ...(row.base_revision == null
              ? {}
              : { head: String(row.base_revision) }),
          },
        })
      }
      if (row.exit_code != null) {
        ctx.also({ entity: { eid: me }, exit: { code: num(row.exit_code) } })
      }
      if (row.process != null) {
        ctx.also(link(me, 'references', ctx.ref(row.process)!))
      }
      if (row.pid != null) {
        ctx.also({ entity: { eid: me }, process: { pid: num(row.pid) } })
      }
      if (row.final_text != null) {
        ctx.also({
          entity: { eid: derivedEid(`final|${me}`), num: null },
          content: { body: String(row.final_text) },
          output: { source: me },
        })
      }
      if (row.stderr != null) {
        ctx.also({
          entity: { eid: derivedEid(`stderr|${me}`), num: null },
          content: { body: String(row.stderr) },
          output: { source: me },
        })
      }
      if (row.usage_json != null) {
        let u = json(row.usage_json)
        if (u) ctx.also({ entity: { eid: me }, usage: u })
      }
      if (row.provider_session_id != null) {
        ctx.also({
          entity: { eid: me },
          openai: { response_id: String(row.provider_session_id) },
        })
      }
      for (
        let col of [
          'turn',
          'latest_seq',
          'status',
          'source',
          'pane',
          'transcript',
          'agent_type',
          'signal_at',
          'signal_accepted_at',
          'signal_token',
          'origin',
          'serving_model',
          'started_at',
          'stop_requested_at',
          'input_at',
          'finished_at',
          'stop_reason',
        ]
      ) if (row[col] != null) ctx.lost(`session.${col}`)
      return {
        id: String(row.id),
        actor: ctx.ref(row.actor),
        operator: bool(row.operator),
        standing: text(row.standing),
      }
    },
  },
  settled: {
    says: 'session',
    // Settled means nothing is owed, so it is read off the entries; the exit
    // code belongs to the program.
    make: (row, ctx) => {
      if (row.exit_code != null) {
        ctx.also({
          entity: { eid: ctx.ref(row.entity)! },
          exit: { code: num(row.exit_code) },
        })
      }
      ctx.lost('settled.*')
      return null
    },
  },
  spawn: {
    says: 'using',
    onto: (row, ctx) =>
      ctx.firstEntry(ctx.ref(row.entity)!) ?? ctx.ref(row.entity),
    // What was ASKED for is the `using` on the first entry, the same word a
    // mid-transcript switch says; the persona it wears is an edge.
    make: (row, ctx) => {
      let me = ctx.ref(row.entity)!
      if (row.persona != null) {
        ctx.also(link(me, 'references', ctx.ref(row.persona)!))
      }
      let provider = row.provider && ctx.provider(String(row.provider))
      let model = row.model && ctx.model(String(row.model))
      if (!provider && !model && row.effort == null) return null
      return {
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(row.effort == null ? {} : { effort: String(row.effort) }),
      }
    },
  },
  stderr: asCall('stderr', 'text'),
  stop_request: {
    says: 'stop',
    // A stop is an ENTRY, so the daemon reads it where it reads everything
    // else, and a fork from before it does not inherit it.
    onto: (row, ctx) => ctx.ref(row.entity),
    make: () => ({}),
  },
  task_context: asCall('task_context'),
  timeout: asCall('timeout', 'ms'),
  tool_use: null, // the transcript's renamed log block; `call` already says it
  usage: same('usage', 'input', 'cached', 'output', 'reasoning'),
  worktree: {
    says: 'worktree',
    make: (row, ctx) => ({
      path: text(row.cwd),
      branch: row.branch == null ? undefined : ctx.branch(String(row.branch)),
      head: text(row.base_revision),
      repository: row.cwd ? ctx.repository(String(row.cwd)) : undefined,
    }),
  },
  yield: {
    says: 'content',
    // `final_text` is the last output's prose and `stderr` is prose wearing
    // the stream it came off; `usage_json` is @yaks/model's `usage`.
    make: (row, ctx) => {
      let me = ctx.ref(row.entity)!
      for (
        let [col, word] of [['final_text', 'final'], ['stderr', 'stderr']]
      ) {
        if (row[col] == null) continue
        ctx.also({
          entity: { eid: derivedEid(`${word}|${me}`), num: null },
          content: { body: String(row[col]) },
          output: { source: me },
        })
      }
      if (row.usage_json != null) {
        let u = json(row.usage_json)
        if (u) ctx.also({ entity: { eid: me }, usage: u })
      }
      return null
    },
  },
}

let json = (v: unknown): Record<string, number> | undefined => {
  try {
    let o = JSON.parse(String(v)) as Record<string, unknown>
    let out: Record<string, number> = {}
    for (let k of ['input', 'cached', 'output', 'reasoning']) {
      if (typeof o[k] == 'number') out[k] = o[k]
    }
    return Object.keys(out).length ? out : undefined
  } catch {
    return undefined
  }
}

/** An edge, said the way @yaks/edge says one: its id is the sentence. */
let link = (from: Eid, relation: string, to: Eid): Bundle => ({
  entity: { eid: edgeEid(from, relation, to), num: null },
  edge: { from, to },
  [relation]: {},
})

// What has to be written before what. A component that VALIDATES a reference
// — an entry's session, a claim's session — cannot be written before the thing
// it names exists, so those few go first; the rest are order-free, because a
// reference mints the spine it points at.
let FIRST = ['model', 'provider', 'person', 'persona', 'project', 'session']

// And what has to be written after everything else. `updated` is stamped by
// the graph on every patch to an entity that already existed — which the whole
// export is — so the fleet's own reading of when a thing last changed has to
// land last, or half a million entities read as changed today.
let LAST = ['updated']

// The relation tags an edge entity wears. An edge is ONE sentence, so its two
// ends and its tag are written in one bundle — said apart, the half with no
// tag is not an edge yet and @yaks/edge refuses it.
let NATURES = new Set([
  'about',
  'contains',
  'delegates',
  'reads',
  'recalled',
  'references',
  'requires',
  'satisfies',
  'supersedes',
  'supervises',
  'wants',
  'worked',
])

// The facets that are a tool call rather than a component of their own, in the
// order a name is taken from them when a row wears more than one.
let FACETS = [
  'bash',
  'fetch',
  'patch',
  'apply',
  'graph_query',
  'headers',
  'opaque',
  'response',
  'stderr',
  'timeout',
  'task_context',
]

// ─── the doc, as the checklist it is ─────────────────────────────────────────

/** The `| fleet comp |` rows of docs/transition.md: what the doc says each
 * fleet component becomes, or `null` where nothing takes it. */
let saidByDoc = (root: URL): Map<string, string | null> =>
  new Map(
    Deno.readTextFileSync(new URL('docs/transition.md', root))
      .split('\n')
      .filter((l) => /^\| `/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      .map(([comp, , pkg, says]) => [
        comp.replaceAll('`', ''),
        pkg == '—' ? null : says.replaceAll('`', ''),
      ]),
  )

// ─── the run ─────────────────────────────────────────────────────────────────

let arg = (name: string, fallback?: string): string => {
  let i = Deno.args.indexOf(`--${name}`)
  let v = i < 0 ? fallback : Deno.args[i + 1]
  if (v == null) throw new Error(`--${name} is required`)
  return v
}

let root = new URL('../', import.meta.url)

let main = async () => {
  let from = arg('from')
  let to = arg('to')
  let config = arg('config', new URL('etc/yak.json', root).pathname)
  let limit = Number(arg('limit', '0')) || 0
  let batchSize = Number(arg('batch', '4000'))

  // The doc and this file must agree before a byte moves.
  let doc = saidByDoc(root)
  let trouble: string[] = []
  for (let [comp, says] of doc) {
    if (!(comp in MOVES)) {
      trouble.push(`${comp}: the doc moves it, this does not`)
    } else if (says == null && MOVES[comp]) {
      trouble.push(
        `${comp}: the doc drops it, this moves it to ${MOVES[comp]!.says}`,
      )
    } else if (says != null && !MOVES[comp]) {
      trouble.push(`${comp}: the doc says ${says}, this drops it`)
    } else if (says != null && MOVES[comp]!.says != says) {
      trouble.push(
        `${comp}: the doc says ${says}, this says ${MOVES[comp]!.says}`,
      )
    }
  }
  for (let comp of Object.keys(MOVES)) {
    if (!doc.has(comp)) {
      trouble.push(`${comp}: this moves it, the doc has no row`)
    }
  }
  if (trouble.length) {
    console.error('the table and docs/transition.md disagree:')
    for (let t of trouble) console.error('  ' + t)
    Deno.exit(1)
  }

  let fleet = new Database(from, { readonly: true })
  let all = (sql: string, ...params: unknown[]): Row[] =>
    fleet.prepare(sql).all(...params as never[]) as Row[]

  console.log(`reading ${from}`)
  let started = performance.now()
  let at = started
  let phases: [string, number][] = []
  let say = (what: string) => {
    let now = performance.now()
    let took = (now - at) / 1000
    at = now
    phases.push([what, took])
    console.log(`  ${what}: ${took.toFixed(1)}s`)
  }

  // ── the spine, and the two re-identifications over it ──
  let spine = new Map<number, Spine>()
  for (let r of all('select id, eid, num from entity')) {
    spine.set(Number(r.id), {
      eid: String(r.eid),
      num: r.num == null ? null : Number(r.num),
    })
  }
  // A commit's id IS its sha: a column restating it is a second copy that can
  // disagree. Every reference and every edge sentence follows the new name.
  let renamed = new Map<string, string>()
  for (let r of all('select entity, sha from "commit" where sha is not null')) {
    let s = spine.get(Number(r.entity))
    if (s) renamed.set(s.eid, String(r.sha))
  }
  let eidOf = (id: unknown): string | undefined => {
    let s = spine.get(Number(id))
    if (!s) return undefined
    return renamed.get(s.eid) ?? s.eid
  }

  let bodies = new Map<number, string>()
  for (let r of all('select entity, value from blob_text')) {
    bodies.set(Number(r.entity), String(r.value))
  }

  let firsts = new Map<string, string>()
  for (
    let r of all(
      'select session, min(seq) as seq, entity from entry group by session',
    )
  ) {
    let s = eidOf(r.session)
    let e = eidOf(r.entity)
    if (s && e) firsts.set(s, e)
  }

  let named = (table: string, col = 'name'): Map<string, string> => {
    let out = new Map<string, string>()
    for (let r of all(`select entity, "${col}" from "${table}"`)) {
      let e = eidOf(r.entity)
      if (e && r[col] != null) out.set(String(r[col]), e)
    }
    return out
  }
  let models = named('model')
  let providers = named('provider')

  // ── the host ──
  let cfg = read(config)
  say('read')
  console.log(`composing ${cfg.plugins?.length} plugins over ${to}`)
  try {
    Deno.removeSync(to)
  } catch { /* a fresh file is the normal case */ }
  // The import writes the graph but NOT its log: the fleet's own three-table
  // journal is the history, and it is copied across whole at the end.
  let load = async (spec: string): Promise<Module> => {
    let m = await import(spec) as Module
    if (!spec.endsWith('/core.ts')) return m
    return {
      ...m,
      rules: (host) =>
        (m.rules?.(host) ?? []).filter((p) => p.name != '@yaks/journal'),
    }
  }
  // The store ADOPTS what each bundle states its number to be — the fleet's
  // own, or `null` for the entities this export creates, which wear none.
  let host = await compose({ ...cfg, db: to, port: 0, adopt: true }, load)

  let emitted: Record<string, number> = {}
  let dropped: Record<string, number> = {}
  let elsewhere: Record<string, number> = {}
  let lost: Record<string, number> = {}
  let minted = new Map<string, string>()
  let batch: Bundle[] = []
  let written = 0
  let refused: Record<string, number> = {}
  let flush = async () => {
    if (!batch.length) return
    let sending = batch
    batch = []
    try {
      await host.graph.apply(sending, { trusted: true })
      written += sending.length
    } catch {
      // A batch is atomic, so one bundle the packages will not take would
      // lose every other bundle beside it. An export finishes and SAYS what
      // did not fit, so the refused one is found by sending them singly.
      for (let b of sending) {
        try {
          await host.graph.apply([b], { trusted: true })
          written++
        } catch (e) {
          let why = (e as Error).message.slice(0, 120)
          refused[why] = (refused[why] ?? 0) + 1
        }
      }
    }
  }
  let push = async (b: Bundle) => {
    batch.push(b)
    if (batch.length >= batchSize) await flush()
  }

  let ctx: Ctx = {
    ref: eidOf,
    tool: (name) => {
      let held = minted.get(`tool|${name}`)
      if (held) return held
      let eid = derivedEid(`tool|${name}`)
      minted.set(`tool|${name}`, eid)
      batch.push({ entity: { eid, num: null }, tool: { name } })
      return eid
    },
    model: (name) => models.get(name),
    provider: (name) => providers.get(name),
    branch: (name) => {
      let eid = derivedEid(`ref|${name}`)
      if (!minted.has(`ref|${name}`)) {
        minted.set(`ref|${name}`, eid)
        batch.push({ entity: { eid, num: null }, ref: { name } })
      }
      return eid
    },
    repository: (name) => {
      let eid = derivedEid(`repository|${name}`)
      if (!minted.has(`repo|${name}`)) {
        minted.set(`repo|${name}`, eid)
        batch.push({
          entity: { eid, num: null },
          repository: name.includes('://')
            ? { origin: name }
            : { common: name },
        })
      }
      return eid
    },
    firstEntry: (session) => firsts.get(session),
    body: (id) => bodies.get(Number(id)),
    also: (b) => batch.push(b),
    lost: (column) => lost[column] = (lost[column] ?? 0) + 1,
  }

  // ── pass 0: the spine, numbers and all ──
  // An identity is not a patch — it is storage's own row — so it goes in
  // through storage's own statement (@yaks/sqlite `mintSql`), each entity
  // stating the number it already wears or `null` for one that wears none.
  // It happens FIRST because a reference mints the spine it names, and the
  // first mint is the one that decides the number: T-37574 read as T-37574
  // here only if nothing numbered that eid on the way past.
  console.log(`spines: ${spine.size}`)
  let sql = host.sql
  sql.exec('begin')
  for (let [, s] of spine) {
    let m = mintSql(renamed.get(s.eid) ?? s.eid, s.num ?? false)
    sql.query(m.sql, m.params)
  }
  sql.exec('commit')
  say('spines')

  // ── pass 1: every component, as the table says ──
  let tables = new Set(
    all(
      `select name from sqlite_master where type='table'`,
    ).map((r) => String(r.name)),
  )
  // The two ends of every edge, to be written beside the tag that says what
  // the sentence means.
  let sentences = new Map<number, { from: string; to: string; ord?: number }>()
  for (let r of all('select entity, "from", "to", ord from edge')) {
    let from = eidOf(r['from'])
    let to = eidOf(r['to'])
    if (!from || !to) continue
    sentences.set(Number(r.entity), {
      from,
      to,
      ...(r.ord == null ? {} : { ord: Number(r.ord) }),
    })
  }

  // Which facet, if any, names the tool of each call-shaped row.
  let toolOf = new Map<number, string>()
  for (let r of all('select entity, name from tool_use')) {
    toolOf.set(Number(r.entity), String(r.name))
  }

  let order = [
    ...FIRST,
    ...Object.keys(MOVES).filter((c) =>
      !FIRST.includes(c) && !LAST.includes(c)
    ),
    ...LAST,
  ]
  for (let comp of order) {
    let move = MOVES[comp]
    if (!tables.has(comp)) {
      emitted[comp] = 0
      continue
    }
    let count = Number(
      all(`select count(*) as n from "${comp}"`)[0].n as number,
    )
    if (!move) {
      dropped[comp] = count
      emitted[comp] = 0
      continue
    }
    if (move.elsewhere) {
      elsewhere[comp] = count
      emitted[comp] = 0
      continue
    }
    // Each component's own rows go in as one run, and the run is flushed
    // before the next begins, so an ordering above is an ordering in fact.
    let rows = all(
      `select * from "${comp}"` + (limit ? ` limit ${limit}` : ''),
    )
    let made = 0
    for (let row of rows) {
      let self = eidOf(row.entity)
      if (!self) continue
      if (FACETS.includes(comp) || comp == 'call') {
        row.$tool = toolOf.get(Number(row.entity)) ?? comp
      }
      let comps = move.make(row, ctx)
      if (!comps) continue
      let onto = move.onto ? move.onto(row, ctx) : self
      if (!onto) continue
      let ends = NATURES.has(comp)
        ? sentences.get(Number(row.entity))
        : undefined
      await push({
        entity: { eid: onto },
        [move.says]: comps,
        ...(ends ? { edge: ends } : {}),
      })
      made++
    }
    emitted[comp] = made
    dropped[comp] = count - made
    await flush()
  }
  say('components')

  // ── pass 2: the graves ──
  // A tombstone is spine storage, not a component: nothing can be written
  // THROUGH the graph that says "this eid died and was never anything".
  let graves = all('select entity, deleted_at from tombstone')
  let bury = sql
  bury.exec('begin')
  for (let g of graves) {
    let s = spine.get(Number(g.entity))
    if (!s) continue
    bury.query(
      `insert or ignore into tombstone (entity, deleted_at)
         select id, ? from entity where eid = ?`,
      [String(g.deleted_at), renamed.get(s.eid) ?? s.eid],
    )
  }
  bury.exec('commit')
  say('graves')

  // ── pass 3: the log ──
  // The fleet's three-table journal is already the package's layout (9952cc18),
  // so it copies across as-is — only the integer ids are this store's, so they
  // are read back through the eid each one named.
  let here = new Map<string, number>()
  for (let r of bury.query('select id, eid from entity', [])) {
    here.set(String(r.eid), Number(r.id))
  }
  let idOf = (id: unknown): number | null => {
    let s = spine.get(Number(id))
    if (!s) return null
    return here.get(renamed.get(s.eid) ?? s.eid) ?? null
  }
  let logged = { tx: 0, change: 0, field: 0 }
  // Three million rows go in as multi-row inserts rather than one statement
  // each: the same rows, two orders of magnitude fewer round trips.
  let CHUNK = 250
  let pour = (
    into: string,
    cols: string[],
    rows: (unknown[] | null)[],
  ): number => {
    let kept = rows.filter((r) => !!r) as unknown[][]
    let names = cols.map((c) => `"${c}"`).join(', ')
    let one = `(${cols.map(() => '?').join(', ')})`
    bury.exec('begin')
    for (let i = 0; i < kept.length; i += CHUNK) {
      let slice = kept.slice(i, i + CHUNK)
      bury.query(
        `insert into ${into} (${names}) values ${
          slice.map(() => one).join(', ')
        }`,
        slice.flat() as Parameters<typeof bury.query>[1],
      )
    }
    bury.exec('commit')
    return kept.length
  }

  logged.tx = pour(
    'journal_tx',
    ['id', 'ts', 'actor', 'via', 'trace'],
    all(
      'select * from journal_tx',
    ).map((r) => [
      Number(r.id),
      String(r.ts),
      idOf(r.actor),
      idOf(r.via),
      r.trace == null ? null : String(r.trace),
    ]),
  )

  let changes = new Set<number>()
  logged.change = pour(
    'journal_change',
    ['id', 'tx', 'ordinal', 'entity', 'component', 'operation'],
    all('select * from journal_change').map((r) => {
      let entity = idOf(r.entity)
      if (entity == null) return null
      changes.add(Number(r.id))
      return [
        Number(r.id),
        Number(r.tx),
        Number(r.ordinal),
        entity,
        String(r.component),
        String(r.operation),
      ]
    }),
  )

  logged.field = pour(
    'journal_field',
    ['id', 'change', 'ordinal', 'field', 'present', 'value', 'ref'],
    all('select * from journal_field').map((r) =>
      !changes.has(Number(r.change)) ? null : [
        Number(r.id),
        Number(r.change),
        Number(r.ordinal),
        String(r.field),
        Number(r.present),
        r.value == null ? null : String(r.value),
        r.ref == null ? null : idOf(r.ref),
      ]
    ),
  )

  say('journal')
  host.close()
  fleet.close()

  // ── what moved ──
  let seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`\n  fleet comp           emitted   dropped`)
  let totals = { emitted: 0, dropped: 0 }
  for (let comp of Object.keys(MOVES).sort()) {
    let e = emitted[comp] ?? 0
    let d = dropped[comp] ?? 0
    totals.emitted += e
    totals.dropped += d
    if (e || d) {
      console.log(
        `  ${comp.padEnd(20)} ${String(e).padStart(8)}  ${
          String(d).padStart(8)
        }`,
      )
    }
  }
  console.log(
    `  ${'TOTAL'.padEnd(20)} ${String(totals.emitted).padStart(8)}  ${
      String(totals.dropped).padStart(8)
    }`,
  )
  for (let [comp, n] of Object.entries(elsewhere)) {
    console.log(
      `  ${comp.padEnd(20)} ${String(n).padStart(8)} rows: ${
        MOVES[comp]!.elsewhere
      }`,
    )
  }
  if (Object.keys(refused).length) {
    console.log(`\n  bundles the packages refused:`)
    for (let [why, n] of Object.entries(refused).sort()) {
      console.log(`    ${String(n).padStart(6)} × ${why}`)
    }
  }
  if (Object.keys(lost).length) {
    console.log(`\n  columns with no home in the packages:`)
    for (let [k, n] of Object.entries(lost).sort()) {
      console.log(`    ${k.padEnd(32)} ${n}`)
    }
  }
  console.log(
    `\n  spines ${spine.size} · bundles ${written} · graves ${graves.length}` +
      ` · journal ${logged.tx}/${logged.change}/${logged.field}` +
      ` · ${seconds}s`,
  )
  console.log(
    '  ' + phases.map(([w, t]) => `${w} ${t.toFixed(1)}s`).join(' · '),
  )
}

if (import.meta.main) await main()
