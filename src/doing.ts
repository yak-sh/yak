// The DOING half of the graph: the curated post-commit effect registry and
// the boot-time reconcile + recurring sweeps that keep the world matching the
// data. Extracted from server.ts (D-22388 step 3) so it can run in either
// process:
//
//   inline (default)      — the serving process calls wireDoing() + bootDoing()
//                           itself, exactly the pre-extraction behavior. Tests,
//                           probes, and any bare `deno run src/server.ts` get
//                           this with no configuration.
//   split (TASKS_EFFECTS=daemon) — the server wires the registry (it still
//                           relays and dispatches the few `where:'serve'` rows
//                           welded to its in-memory runner) but bootDoing()
//                           and every `where:'do'` row belong to the effects
//                           daemon (effectsd.ts), a journal-cursor consumer
//                           holding the `-effects.lock` lease.
//
// The registry is ALWAYS wired whole in both processes — a row a process does
// not own registers with its real handler or an inert stub, and the dispatch/
// relay `want` filter is what keeps each row firing in exactly one process.
// Whole-in-both is load-bearing: docs() (the Vocabulary doc's Effects list)
// and the sweep declarations must see one complete list wherever they read it.
//
// Handlers here run where the DOING process runs. Their casts reach browsers
// either directly (inline) or — in split mode, where the daemon's cast is a
// no-op — through the serving process's journal feed, which rebroadcasts every
// journaled row (apply() and record() both journal). That is what retires the
// handler-internal-cast residue T-22496 documented.
import { type Change } from './types.ts'
import { db } from './live_db.ts'
import { docs, on, relay } from './effects.ts'
import { PENDING } from './deliver.ts'
import { ensureFixer, fileBug, FIXER_ROLE, HEAL_PENDING } from './heal.ts'
import { recallEntry } from './recall.ts'
import { referencedEntry } from './referenced.ts'
import { fanout, FANOUT_PENDING, mailed } from './mail.ts'
import { native as nativeMailer } from './mailer.ts'
import { closingTask } from './closing.ts'
import { unblocking } from './unblock.ts'
import { knocked } from './knock.ts'
import { waking } from './wake.ts'
import { scheduleArm, scheduleKnocked, scheduleSettled } from './schedule.ts'
import { DREAM_PENDING, DREAM_ROLE, dreamComb } from './dream.ts'
import { fleetApi, inboundSweep, isLive, mayStamp } from './inbound.ts'
import { SCRIBE } from './scribe.ts'
import { dispatchSweep } from './dispatch.ts'
import { ruled } from './spawnrule.ts'
import { embedSweep } from './embed.ts'
import { initVector, ownVector } from './vector.ts'
import { projection, syncFiles } from './persona.ts'
import { commit } from './git.ts'
import {
  codexPending,
  commented,
  deleted,
  graphCodex,
  type Launch,
  reapLeases,
  reconfigured,
  recover,
  spawned,
  standingBackfill,
  stopped,
  tidy,
  watched,
} from './sessions.ts'
import { nativeSweep, noticeAccepted } from './tmux.ts'
import {
  registerSystem,
  roleAttention,
  roleBoot,
  roleClaim,
  roleConfig,
  roleDoc,
  rolePersona,
  roleRemoved,
  roleSession,
  systemSweep,
} from './roles.ts'
import { prune as pruneTree, reap as reapProbes, sweep } from './probes.ts'
import { obeyed } from './obey.ts'
import { record } from './telemetry.ts'
import { readEntries } from './entries.ts'
import { graphLog } from './entry_log.ts'
import { sweepSelect, vocabularyDoc } from './db.ts'
import { projectionGraph } from './graph_query.ts'
import { vocabularyMd } from './schema.ts'
import { repeat } from './timers.ts'

type Cast = (changes: Change[]) => void

// The serving process's in-memory runner hooks (managedCodex + the graph-
// native sweep debounce). Present only where that runner lives; the daemon
// registers the same rows with inert stubs it will never fire (the `want`
// filter owns that guarantee, not the stubs).
export type Native = {
  soon: () => void
  start: (eid: string, job: Launch) => Promise<void>
  remove: (eid: string) => void
  stop: (eid: string, target: string) => unknown
  comment: (target: string, eid: string) => unknown
}

export type Doing = {
  cast: Cast
  native?: Native
  codexReady: () => Promise<boolean>
  readyProviders: Parameters<typeof dispatchSweep>[1]
}

// Which half of the split this process is. server.ts asks with its own role
// in hand; effectsd is always the 'do' owner of a split.
export let splitEffects = () => Deno.env.get('TASKS_EFFECTS') == 'daemon'

// The committed spawn's provider, read post-commit — what routes a session
// row to the graph-native arm (serve) or the process arm (do). An external
// session (no spawn row) has no provider and belongs to the process arm,
// whose spawned() already returns without one.
let spawnProviderOf = (eid: string): string | undefined =>
  (db.prepare(
    `select s.provider as provider from spawn s
     join entity e on e.id = s.entity where e.eid = ?`,
  ).get(eid) as { provider: string | null } | undefined)?.provider ?? undefined

// Registrations, whole, in every process. Rows welded to the serving
// process's runner carry where:'serve'; everything else defaults to 'do'.
export let wireDoing = (d: Doing) => {
  let { cast } = d
  let native: Native = d.native ?? {
    soon: () => {},
    start: () => Promise.resolve(),
    remove: () => {},
    stop: () => {},
    comment: () => {},
  }
  // The graph-native runner rows — serve-owned: the runner streams
  // observations over the serving process's sockets and settles in its drain.
  on('runner', {
    where: 'serve',
    created: native.soon,
    sweep: { pending: "name = 'tasksd'" },
    doc: 'boot the graph-native runner through the ordinary effect relay; ' +
      'live entry births wake it through their own hook',
  })
  on('entry', {
    where: 'serve',
    created: native.soon,
    doc: 'a new Session entry wakes the graph-native runner; ' +
      'its indexed candidate query decides whether there is work',
  })
  on('message', {
    created: recallEntry(cast),
    doc: 'memory auto-recall (T-17306): a new message entry surfaces the ' +
      "nearest memories by title into the session's own log as a `recalled` " +
      'entry (deduped per session), which the channel delivers as kind=recall; ' +
      'new messages only, no history sweep, and a recall entry carries no ' +
      'message facet so it never recalls itself',
  })
  on('entry', {
    created: referencedEntry(cast),
    doc:
      'referenced edges (D-21262): a new entry’s text is parsed for entity ' +
      'ids and page urls, and each resolved citation lands as an ' +
      'entry→referenced→target edge — pure mechanics, no inference',
  })
  // One launch request, two arms: the provider decides which process acts.
  // The graph-native arm lives beside the runner (serve); the process arm —
  // claude, codex-cli, and every spawnless external session — is the doing
  // half's. spawned() itself validates either way; the gate only keeps the
  // wrong process from acting.
  on('session', {
    where: 'serve',
    created: (eid, comp) => {
      let p = spawnProviderOf(eid)
      if (p && graphCodex(p)) return spawned(cast, native.start)(eid, comp)
    },
    removed: (eid) => native.remove(eid),
    sweep: { pending: codexPending },
    doc: 'a session created with a graph-native spawn spec launches on the ' +
      'in-process runner; a deleted session stops its native run',
  })
  on('session', {
    created: (eid, comp) => {
      let p = spawnProviderOf(eid)
      if (!p || !graphCodex(p)) return spawned(cast)(eid, comp)
    },
    removed: deleted,
    doc: 'a session created with a process spawn spec is a launch request — ' +
      'validate, launch the agent; a deleted session stops its process',
  })
  let respawn = (arm: 'native' | 'process') => (eid: string, comp: Row) => {
    let p = spawnProviderOf(eid)
    let mine = !!p && graphCodex(p) == (arm == 'native')
    if (!mine) return
    return arm == 'native'
      ? reconfigured(cast, native.start)(eid, comp)
      : reconfigured(cast)(eid, comp)
  }
  on('spawn', {
    where: 'serve',
    changed: {
      provider: respawn('native'),
      model: respawn('native'),
      effort: respawn('native'),
      persona: respawn('native'),
    },
    doc: 'correcting a graph-native launch spec retries a failed Session',
  })
  on('spawn', {
    changed: {
      provider: respawn('process'),
      model: respawn('process'),
      effort: respawn('process'),
      persona: respawn('process'),
    },
    doc: 'correcting the launch spec retries a Session that failed before ' +
      'its provider or workspace started',
  })
  on('session', {
    created: watched(cast),
    changed: { pid: watched(cast) },
    doc: 'a session that announced a provider process gets watched: say when ' +
      'the process leaves, counting its transcript if it wrote one (we never ' +
      'forked it, so there is no exit code to report)',
  })
  on('session', {
    changed: { turn: noticeAccepted(cast) },
    doc: 'a busy native-TUI turn after a submitted wake-up records ' +
      'acceptance; graph message content remains pending until task_context ' +
      'surfaces it',
  })
  on('stop_request', {
    created: stopped(cast),
    sweep: { pending: PENDING('stop_request') },
    doc: 'the brake: signal the targeted session to stop, settle delivered',
  })
  on('stop_request', {
    where: 'serve',
    created: (eid, comp) => native.stop(eid, String(comp.target)),
    sweep: { pending: PENDING('stop_request') },
    doc: 'a graph-native Codex stop appends cancellation, aborts its leased ' +
      'operation, and settles the stop request without a process signal',
  })
  on('role', {
    created: roleBoot(cast),
    changed: {
      state: roleConfig(cast),
      surface: roleConfig(cast),
      scope: roleConfig(cast),
      checkout: roleConfig(cast),
      schedule: roleConfig(cast),
      wake_policy: roleConfig(cast),
      wake_target: roleConfig(cast),
      retry_at: roleConfig(cast),
      quiet: roleConfig(cast),
      cooldown: roleConfig(cast),
    },
    removed: roleRemoved(cast),
    sweep: { pending: '1' },
    doc: 'a desired-state change wakes its role; a removed role closes its ' +
      'deterministic native tmux door',
  })
  on('doc', {
    created: roleDoc(cast),
    changed: {
      title: roleDoc(cast),
      body: roleDoc(cast),
    },
    doc: 'role and project instructions changing re-drive only their roles',
  })
  on('repo', {
    created: roleConfig(cast),
    changed: {
      path: roleConfig(cast),
      base_branch: roleConfig(cast),
    },
    doc: 'a role scope repo change re-drives that scope’s roles',
  })
  on('project', {
    created: roleConfig(cast),
    changed: { color: roleConfig(cast) },
    doc: 'a role scope palette change re-drives that scope’s native roles',
  })
  on('spawn', {
    created: roleConfig(cast),
    changed: {
      provider: roleConfig(cast),
      model: roleConfig(cast),
      effort: roleConfig(cast),
      persona: rolePersona(cast),
    },
    doc: 'role launch configuration changes wake only the role that owns it',
  })
  on('session', {
    created: roleSession(cast),
    changed: {
      status: roleSession(cast),
      origin: roleSession(cast),
      finished_at: roleSession(cast),
      notice_at: roleSession(cast),
    },
    doc: 'a persistent role run changing re-drives only its owning role',
  })
  on('session', {
    created: roleClaim(cast),
    doc:
      'an operator claims its role on boot (T-19453): whoever holds the live ' +
      'claim IS the operator, so the reconciler defers to it and never spawns a ' +
      'duplicate — managed spawns and interactive operators alike, no hook needed',
  })
  on('comment', {
    created: commented(cast),
    doc:
      'a comment on claimed work resumes or steers its process-backed run; ' +
      'a direct session target remains deprecated compatibility',
  })
  on('comment', {
    created: (_eid, comp) => roleAttention(cast)(String(comp.target)),
    doc: 'a comment wakes only the role that owns or scopes its target',
  })
  on('knock', {
    created: (_eid, comp) => roleAttention(cast)(String(comp.target)),
    doc: 'a knock wakes only the role that owns or scopes its target',
  })
  on('comment', {
    where: 'serve',
    created: (eid, comp) => native.comment(String(comp.target), eid),
    doc: 'a comment on claimed work appends content-free attention to its ' +
      'graph-native run; direct session targets remain compatibility',
  })
  on('comment', {
    created: obeyed(cast, d.codexReady),
    doc: 'a comment whose first line opens with `:` is a command line — ' +
      'run against its target, as its author, answered by an event comment',
  })
  on('task', {
    changed: { status: closingTask(cast) },
    doc: 'closing a task archives the correspondence about it — the ' +
      'letters and comments that were waiting at the moment it closed, ' +
      'never anything that arrives after',
  })
  on('task', {
    changed: { status: unblocking(cast) },
    doc: 'an ended task knocks the claimant session of every task that ' +
      'requires it and is now fully unblocked — the dep-completion wake ' +
      'that resumes a parked run to finish its own task (D-21448)',
  })
  on('knock', {
    created: knocked(cast),
    sweep: { pending: PENDING('knock') },
    doc: 'attention, resolved: cast to whoever is awake for the recipient, ' +
      'spawn a project operator onto the target, or mail an addressed ' +
      'person — settle delivered/error either way',
  })
  on('knock', {
    created: dreamComb(cast),
    // Boot reconcile: a dream knock whose comb never ran (a crash in the gap)
    // re-drives — the same outbox pattern as the ladder above (D-17362).
    sweep: { pending: DREAM_PENDING },
    doc: 'the dream: a cadence knock to a venture dream combs its sessions ' +
      'finished since the floor cursor, flagging drift as consider tasks and ' +
      'capturing owner decisions as memories — FLAG-only, never a fix (T-12800)',
  })
  on('role', {
    created: (eid) => scheduleArm(eid, cast),
    changed: {
      schedule: (eid) => scheduleArm(eid, cast),
      wake_policy: (eid) => scheduleArm(eid, cast),
      state: (eid) => scheduleArm(eid, cast),
    },
    // Boot: every role reconciles its clock — a cadence missed while the
    // server was down is one pending row again, never a storm.
    sweep: { pending: '1' },
    doc: 'a running scheduled role keeps exactly one pending self-wake at ' +
      'its next instant; any other role keeps none (D-18722 part B)',
  })
  on('session', {
    changed: { status: scheduleSettled(cast) },
    doc: 'a role session reaching a terminal status re-arms its scheduled ' +
      'role’s next self-wake',
  })
  on('knock', {
    created: (eid) => scheduleKnocked(cast)(eid),
    doc: 'a fired cadence knock re-arms the next instant, so the cadence ' +
      'never stalls on a run that misses its terminal stamp',
  })
  on('wake', {
    created: waking(cast),
    changed: { at: waking(cast) }, // a moved hour re-arms the timer
    // Not an outbox retry but the RECONCILE: boot hands back every wake
    // still owed, so an hour that passed while the server was down fires
    // now instead of vanishing.
    sweep: { pending: PENDING('wake') },
    doc: 'the timed knock: hold until `at`, then mint the knock and let ' +
      'the ladder deliver — one timer, re-armed at the earliest pending ' +
      'wake and reconciled at boot',
  })
  on('mail', {
    created: mailed(cast),
    // message_id marks INBOUND — a record of arrival the sweep must never
    // hand to delivery (mailed() guards the live path the same way).
    sweep: { pending: `message_id is null and ${PENDING('mail')}` },
    doc: 'deliver the mail — $TASKS_MAIL_CMD when set, else the native ' +
      'Cloudflare sender — resolve the address book reference, settle ' +
      'delivered/error and denormalize to_addr/sent_id (the envelope copy)',
  })
  on('comment', {
    created: fanout(cast),
    sweep: { pending: FANOUT_PENDING },
    doc: "a comment on an addressed project's task fans out as a " +
      'mail to that project (the about edge is the receipt)',
  })
  // A persona's watch is a spawn rule (D-21239, spawnrule.ts): an event about
  // the watched target marks it wanted (a `wants` edge) for the dispatch sweep
  // to spawn under the slot cap; a human's watch stays a delivery subscription.
  // The four event doors below are the inbox item classes (client.ts aboutOf).
  on('comment', {
    created: ruled(cast),
    doc: 'a comment about a persona-watched target marks it wanted — the ' +
      'dispatch sweep instantiates the persona (D-21239)',
  })
  on('notice', {
    created: ruled(cast),
    doc: 'a notice about a persona-watched target marks it wanted (D-21239)',
  })
  on('knock', {
    created: ruled(cast),
    doc: 'a knock about a persona-watched target marks it wanted (D-21239)',
  })
  on('mail', {
    // Only an ARRIVAL is an event — message_id is the inbound mark; an
    // outbound letter about the target is the fleet's own doing.
    created: (eid, comp) =>
      comp.message_id ? ruled(cast)(eid, comp) : undefined,
    doc:
      'arrived mail about a persona-watched target marks it wanted (D-21239)',
  })
  on('exception', {
    created: fileBug(cast),
    // Boot reconcile: every exception no bug yet points at re-drives the filer,
    // which dedups by key regardless — at-least-once, storm-proof (D-17077).
    sweep: { pending: HEAL_PENDING },
    doc: 'self-healing phase 1: an exception (break) facet files ONE deduped ' +
      'bug ticket per distinct fault (kind + normalized message + stack head); ' +
      'recurrences annotate the open ticket instead of multiplying it (D-17077)',
  })
  on('bug', {
    created: ensureFixer(cast),
    // No boot sweep here any more: the fixer system role's reconcile (T-18729,
    // registered below) re-drives open, un-spawned bugs on the system tick —
    // continuously, not just at boot — behind the same gates.
    doc: 'self-healing phase 2: a newly filed bug ticket summons ONE managed ' +
      'fixer session (requested_task = the bug), behind a mute lever, a hard ' +
      'concurrency cap, and a per-fault cooldown — the fixer system role ' +
      're-drives an open, un-spawned ticket once a gate clears (D-17077, ' +
      'T-18729)',
  })

  // Personas follow the graph into each repo's .tasks/ files: any change
  // that could reshape one — a persona born or rehomed, a tier edge
  // spoken or unsaid, a doc edit on a persona or a tiered member —
  // re-renders the fleet (write-if-changed, debounced so a batch lands
  // once) and commits what it wrote, so a persona edit doesn't leave every
  // venture repo dirty. A failed write or commit is a warning, never a
  // broken batch.
  //
  // This lands in the PRIMARY checkout, which an operator may be using
  // right now — so what's safe here and what isn't: the pathspec commit
  // leaves the index alone, so staged work survives (git.ts), and only
  // tracked files are committed, so nothing new appears in their tree.
  // What it does do is advance the branch under them: a worktree's pending
  // `task land` stops being a fast-forward and needs a rebase.
  // That's the trade we take knowingly — one small commit per persona
  // edit, so the rebase is always trivial.
  let syncing: ReturnType<typeof setTimeout> | undefined
  // Nobody reads this process's stdout. A sync that can't land — a tree
  // behind its upstream, a push origin refused — is exactly the failure
  // that decays into a hand repair months later, so every one of them is
  // also a telemetry row: `task telemetry --errors` is where an operator
  // meets it, and the graph's own writes stay unbothered either way.
  let stuck = (e: unknown) => {
    console.warn('persona sync —', e)
    record(db, {
      source: 'srv',
      name: 'persona sync',
      ok: false,
      error: String(e),
    })
  }
  let syncSoon = () => {
    // A probe on a scratch copy must never scribble persona files into the
    // LIVE venture repos it happens to point at: projection() computes each
    // file's path from the project's real repo, not from DB_PATH, so an
    // ungated probe write lands in someone's working tree (T-14612). Only
    // the live instance materializes on a graph change; `task sync` stays
    // the deliberate, operator-run door.
    if (!isLive()) return
    clearTimeout(syncing)
    syncing = setTimeout(async () => {
      try {
        // The projection universe is a bounded keyed walk (every persona +
        // project, closed over tiers), never the whole-graph snapshot — this
        // fires on every persona-ish change, and snapshot() here cost the
        // graph each time (M-21143).
        let { all, deps } = projectionGraph(db)
        let files = projection(all, deps, Date.now())
        for (let f of syncFiles(files).failed) stuck(f)
        // Every projection path, not just this tick's writes: a file some
        // earlier tick left dirty (untracked then, adopted since) is dirt
        // this tick can clear. commit() ignores whatever matches HEAD.
        for (let f of (await commit(files, 'personas: materialize')).failed) {
          stuck(f)
        }
      } catch (e) {
        stuck(e)
      }
    }, 250)
  }
  // Is this eid a persona, or on some persona's tier? The gate that keeps
  // ordinary doc edits and edges from re-rendering the fleet.
  let personaish = (...eids: (string | undefined)[]) =>
    eids.some((e) =>
      e && db.prepare(
        `select 1 from persona
           where entity = (select id from entity where eid = :e)
         union select 1 from dependency d
           join persona p on p.entity = d.parent
           where d.child = (select id from entity where eid = :e)`,
      ).get({ e })
    )
  on('persona', {
    created: syncSoon,
    // home is the persona's home project — re-homing it moves which
    // repo the file lands in, so it must re-render. NOT project: the
    // persona component has no such column (types.ts), and a changed
    // handler naming a column that isn't there never fires.
    changed: { home: syncSoon },
    removed: syncSoon,
    doc: "materialize personas into their projects' .tasks/ files " +
      '(write-if-changed; task sync --commit is the deliberate commit)',
  })
  on('dependency', {
    created: (eid, comp) => personaish(eid, comp.child as string) && syncSoon(),
    doc: 'a tier edge (or common flip) at a persona re-renders its files',
  })
  on('doc', {
    changed: {
      title: (eid) => personaish(eid) && syncSoon(),
      body: (eid) => personaish(eid) && syncSoon(),
    },
    doc: 'a doc edit on a persona or a tiered memory re-renders its files',
  })
  return { syncSoon }
}

type Row = Record<string, unknown>

// Every reconciler runs on a timer, which means nothing is holding its
// promise — and in Deno a rejection nobody handled ENDS THE PROCESS. A sweep
// that throws would take the process, and this process dying costs every
// operator (T-11139). So the guard is the SHAPE here, not a `.catch` each
// caller has to remember. `boot` runs the first pass now, as the boot-time
// reconcile most of them want; the returned runner is the debounce door.
export let tick = (
  name: string,
  sweep: () => unknown,
  ms: number,
  boot = true,
) => {
  let run = async () => {
    try {
      await sweep()
    } catch (e) {
      console.warn(`${name} sweep —`, e)
    }
  }
  if (boot) run()
  repeat(run, ms)
  return run
}

// The boot-time reconcile and the recurring sweeps — the doing owner's half.
// Runs in the serving process (inline mode) or in effectsd (split mode),
// strictly after migrations: the caller guarantees the schema is current
// (the server during its transactional boot; the daemon by being spawned after
// the server's READY beat).
export let bootDoing = (d: Doing, syncSoon: () => void) => {
  let { cast } = d

  // Boot migrations may reshape graph-owned teachings without an apply
  // trace. Reconcile once here too, or the source migrates while its
  // generated persona files keep teaching the retired vocabulary.
  syncSoon()

  // Managed children are detached (setsid) and their owner restarts on every
  // server-file edit — so booting means picking them back up: adopt the ones
  // still alive, finalize the ones that died while we were away. Nothing here
  // reaps a child; the watcher must never learn how.
  recover(cast)

  // The lease half of the same reconcile: a session that ended abnormally
  // never ran its wrap, so its claim leaked and the board lies about who is
  // working. Release every lease whose session has ended, the same way its
  // wrap would have (sessions.ts). Idempotent, so it self-heals on every boot.
  reapLeases(cast)

  // Backfill the native-session `standing` facet (T-17855): existing sessions
  // have logs but no facet stamped until their next transition. Backgrounded
  // and yielding per session — never holds boot. A rejection nobody handles
  // ends the process, so .catch.
  standingBackfill(cast).catch((e) => console.warn('standing backfill —', e))

  tick('native', () => nativeSweep(cast), 2_000)

  // What sessions leave running (probes.ts): a headless browser squatting on
  // a CDP port, a probe server on a scratch db, a worktree with nothing left
  // in it. SessionEnd cannot be this door — a killed session never fires one
  // — so the sweep is a reconciler on a slow tick, reading /proc as it
  // stands. Only the LIVE graph sweeps: a probe server reaping its siblings
  // would be the leak wearing a uniform. No boot pass — a restart is not new
  // evidence. Unattended killing is OPT-IN (TASKS_SWEEP=1).
  if (mayStamp() && Deno.env.get('TASKS_SWEEP') == '1') {
    let repo = Deno.cwd()
    repeat(async () => {
      try {
        let sessions = db.prepare(
          `select o.eid as eid, s.id, s.cwd, s.pid from session s
           join entity o on o.id = s.entity`,
        )
          .all() as {
            eid: string
            id: string
            cwd: string | null
            pid: number | null
          }[]
        // A graph-native session stays resumable until its log is terminal (a
        // final answer, nothing pending) — spare a busy or waiting checkout,
        // let a settled one be collected (T-16761).
        let resumable = (eid: string) => {
          let rows = readEntries(db, eid)
          return rows.length > 0 && !graphLog(rows).terminal
        }
        let seen = sweep(
          sessions.map((s) => ({ ...s, active: resumable(s.eid) })),
          repo,
        )
        let { killed, leaked } = await reapProbes(seen.verdicts)
        let gone = seen.trees.filter((t) => t.prune && pruneTree(repo, t.tree))
        for (let v of seen.verdicts.filter((v) => v.reap)) {
          console.log(`swept ${v.proc.pid} — ${v.why}`)
        }
        for (let t of gone) console.log(`swept ${t.tree.path} — ${t.why}`)
        for (let dir of leaked) console.warn(`profile not removed — ${dir}`)
        if (killed.length || gone.length || leaked.length) {
          record(db, {
            source: 'http',
            name: 'probes',
            // A leak left behind is the failure this run must own, not hide.
            ok: leaked.length == 0,
            detail: `${killed.length} process(es), ${gone.length} worktree(s)` +
              (leaked.length
                ? `, ${leaked.length} profile(s) NOT removed: ${
                  leaked.join(', ')
                }`
                : ''),
          })
        }
      } catch (e) {
        console.warn('probe sweep —', e)
      }
    }, 10 * 60_000)
  }

  // Then the outbox relay: intents that committed but never fired their
  // effect (a crash in the post-commit gap) re-fire now — strictly AFTER
  // recover(), so a re-driven stop finds the adopted pid to signal. Only the
  // sweeps this process owns: in split mode the server relays its own
  // serve-owned rows.
  relay(
    (comp, pending) => db.prepare(sweepSelect(comp, pending)).all() as Row[],
    undefined,
    (w) => w == 'do',
  )

  // Inbound rides the pull (inbound.ts): the fleet-mail sweep, on an
  // interval like the log tailer. Boot sweeps too (idempotency makes it
  // free); unconfigured is dormancy, said once, never an error — and a
  // non-live db is REFUSAL (mayStamp), or a probe inheriting live creds
  // steals delivery.
  if (fleetApi()) {
    tick('inbound', () => inboundSweep(cast), 10_000)
  } else {
    console.log(
      mayStamp()
        ? 'inbound sweep dormant — set FLEET_MAIL_API_URL and FLEET_MAIL_API_TOKEN'
        : 'inbound sweep dormant — non-live db (DB_PATH set); ' +
          'FLEET_MAIL_SWEEP=1 opts in',
    )
  }

  // Which outbound door is armed — said once at boot, so an env flip is
  // verifiable from the journal (per-mail outcomes stamp on the row).
  console.log(
    Deno.env.get('TASKS_MAIL_CMD')
      ? 'mailer: $TASKS_MAIL_CMD'
      : nativeMailer()
      ? 'mailer: native (Cloudflare Email Sending)'
      : 'mailer dormant — set TASKS_MAIL_CMD, or CLOUDFLARE_EMAIL_TOKEN + ' +
        'HOLDCO_CF_ACCOUNT_ID',
  )

  // The system roles (roles.ts): scribe, fixer, dream — on/off and throttle
  // live as role data on their alias entities, and each pass stamps its
  // decision there. The ten-minute tick carries their time-based triggers.
  registerSystem(SCRIBE)
  registerSystem(FIXER_ROLE)
  registerSystem(DREAM_ROLE)
  tick('system', () => systemSweep(cast), 10 * 60_000)

  // Embeddings (embed.ts): every non-comment doc keeps a semantic vector,
  // refreshed a few seconds after its text moves. Boot sweeps the backfill;
  // the interval catches anything the debounce dropped. Only the live
  // instance sweeps (T-14612).
  if (isLive()) {
    // The sweep is the ANN index's only writer, so THIS process owns the
    // native quantize (D-22530), and it must establish the extension's
    // per-connection context itself: the effects process owns a separate
    // connection, so it cannot inherit the server's vector context. Claim
    // before initVector — its trailing refreshVector is a no-op for a
    // non-owner. Both are inert without the extension (T-22622).
    ownVector()
    initVector(db)
    // Defer the first sweep a minute so a fresh process finishes booting before
    // it runs. Embedding is a remote call now (ollama.ts), so this no longer
    // loads a ~400MB onnx model or blocks the event loop — but a model bump can
    // make that first sweep re-embed the WHOLE corpus (~one GPU round-trip per
    // doc, yielding between rows), so letting boot settle first still pays.
    let embedding = tick('embed', () => embedSweep(db), 10 * 60_000, false)
    setTimeout(embedding, 60_000)
    let embedSoon = (() => {
      let t: ReturnType<typeof setTimeout> | undefined
      return () => {
        clearTimeout(t)
        t = setTimeout(embedding, 3_000)
      }
    })()
    on('doc', {
      created: embedSoon,
      changed: { title: embedSoon, body: embedSoon },
      doc: 'docs keep a semantic vector — the embed sweep refreshes what moved',
    })
  }

  // Dispatch (dispatch.ts): approved+ready tasks spawn their own sessions
  // under the slot cap (T-21323, D-21287 Phase 1). Only the live instance
  // dispatches: a probe on a scratch copy must not launch agents.
  if (isLive()) {
    let dispatching = tick(
      'dispatch',
      () => dispatchSweep(cast, d.readyProviders),
      60_000,
    )
    let dispatchSoon = (() => {
      let t: ReturnType<typeof setTimeout> | undefined
      return () => {
        clearTimeout(t)
        t = setTimeout(dispatching, 3_000)
      }
    })()
    on('decided', {
      created: dispatchSoon,
      doc: 'an approval may make its task ready — dispatch sweeps soon',
    })
    on('task', {
      changed: { status: dispatchSoon },
      doc: 'a status move can open a requires gate — dispatch sweeps soon',
    })
    on('claim', {
      removed: dispatchSoon,
      doc: 'a released claim can return a ready task — dispatch sweeps soon',
    })
    on('dependency', {
      created: (_eid, comp) => comp.type == 'wants' && dispatchSoon(),
      doc: 'a spawn-rule mark wants a persona run — dispatch sweeps soon',
    })
  } else {
    console.log('dispatch sweep dormant — not the live instance')
  }

  // Last, the worktree sweep: completed sessions whose merged, clean trees
  // outlived their usefulness let go — at boot, never at settle, so a live
  // resume window stays open (sessions.ts tidy says why).
  tidy(cast)

  // The Vocabulary doc: the schema written into the graph, regenerated from
  // the live structures now that the effects registry is full — including the
  // conditional rows registered just above.
  vocabularyDoc(db, vocabularyMd(docs()))
}
