// The two components this package ships, as one vocabulary document to load
// beside your own.
//
//   process{pid, command, cwd}   a program running on a host
//   exit{code}                   it is over, and how
//
// A process is an ENTITY, not a field on whatever asked for it. That is the
// whole idea: the same row describes a provider CLI a session is a transcript
// of, a web server a supervisor keeps up, and a long-running tool call — so
// one watcher stamps every ending and one word names every pid.
//
// `pid` is the only column an adopted process has, because a pid is the only
// handle a process nobody launched gives you. `command` and `cwd` are present
// exactly when WE started it: they are what we said, not what the kernel says,
// and a supervisor that must relaunch keeps its own desired state rather than
// reading them back.
//
// `exit` is separate from `process` rather than a nullable column on it,
// because their absence means different things: a process with no `exit` is
// running (or was, when we last looked), and that is the query a boot
// reconcile makes. Stamping it is a one-way door — a row that has exited is
// history, and a new run is a new entity.
//
// Output is not declared here. A line a process wrote is `content{body,
// source}` with `source` naming the process — the same word @yaks/session uses
// for a tool result and for what a model said, so anything that can read a
// transcript can read a log.

import type { Entity } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a running program. */
export let PROCESS = 'process'

/** The component stamping that it is over. */
export let EXIT = 'exit'

/** A tracked process. */
export type Process = {
  /** the process id on the host tracking it */
  pid?: number | null
  /** the command line as launched — absent on an adopted process */
  command?: string | null
  /** where it was launched — absent on an adopted process */
  cwd?: string | null
}

/** The stamp an ended process wears. */
export type Exit = {
  /** the status it reported; absent when the ending was seen but the code
   * was not */
  code?: number | null
}

/** A bundle carrying a process, as {@link Store.running} answers with. */
export type Tracked = { entity: Entity } & { process: Process; exit?: Exit }

/**
 * The process vocabulary, to load beside your own:
 * `loadVocab([processDoc, ...mine])`. It says nothing about WHY a process
 * runs — that is an ordinary entity in your own vocabulary pointing at this
 * one.
 */
export let processDoc: VocabDoc = doc
