// The three components this package ships, as one vocabulary document to load
// beside your own.
//
//   service{command, cwd, restart, attempts}   a program that SHOULD run
//   process{pid, command, cwd}                 a program that IS running
//   exit{code}                                 it is over, and how
//
// A process is an ENTITY, not a field on whatever asked for it. That is the
// whole idea: the same components describe a provider CLI a session is a
// transcript of, a web server a supervisor keeps running, and a long-running
// tool call — so one piece of code records every exit code, and one component
// name covers every pid.
//
// `pid` is the only column an adopted process has, because a pid is the only
// handle you get on a process nobody here launched. `command` and `cwd` are
// present exactly when WE started it: they hold the command we asked for, not
// what the kernel reports, and a supervisor that has to start the program again
// keeps its own copy rather than reading it back.
//
// `service` is the wanted half of the same entity: the supervisor acts on a
// component recording that a program should be running, never on a function
// call. It is stored on the SAME entity the process lands on — one entity is
// one supervised program, and reading it tells the whole story (what we want,
// what is running, how the last attempt ended, how many times it has crashed
// and been restarted). To stop a service, write a `stop` component, the marker
// @yaks/session already defines for "nothing happens after this", on the
// service entity itself: no second entity to clean up and no reference to fill
// in.
//
// `exit` is a separate component rather than a nullable column on `process`,
// because their absence means different things: a process with no `exit` is
// running (or was, when we last looked), and that is the query the server makes
// when it starts up. `exit` is never rewritten; on a supervised entity the
// transaction that records the next attempt deletes it, so nothing ever reads a
// fresh pid beside a stale exit code. An unsupervised process keeps its `exit`
// forever, and running the program again creates a new entity.
//
// Output is not declared here. A line a process printed is `content{body}` with
// an `output{source}` naming the process — the same components @yaks/session
// uses for a tool result and for a model's own text, so anything that can read
// a transcript can read a process log.

import type { Entity } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component recording that a program should be running. */
export let SERVICE = 'service'

/** The component naming a running program. */
export let PROCESS = 'process'

/** The component recording that it is over. */
export let EXIT = 'exit'

/** What to do when a service's process exits — systemd's three values. */
export type Restart = 'never' | 'on-failure' | 'always'

/** A program that should be running. */
export type Service = {
  /** the command line to run, argv joined by spaces */
  command?: string | null
  /** where to run it; absent means the supervisor's own working directory */
  cwd?: string | null
  /** what to do when it exits; absent means never */
  restart?: Restart | null
  /** how many times it has been started again after an exit */
  attempts?: number | null
}

/** A tracked process. */
export type Process = {
  /** the process id on the machine tracking it */
  pid?: number | null
  /** the command line it was launched with — absent on an adopted process */
  command?: string | null
  /** where it was launched — absent on an adopted process */
  cwd?: string | null
}

/** What is recorded about a process that has ended. */
export type Exit = {
  /** the exit code it reported; absent when the end was observed but the code
   * was not */
  code?: number | null
}

/** A bundle carrying a process, as {@link Store.running} returns. */
export type Tracked = { entity: Entity } & { process: Process; exit?: Exit }

/**
 * The process vocabulary, to load beside your own:
 * `loadVocab([processDoc, ...mine])`. It does not describe WHY a process
 * runs — that is an ordinary entity in your own vocabulary pointing at this
 * one.
 */
export let processDoc: VocabDoc = doc
