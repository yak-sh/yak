// A file's checkpoints run on a thread of their own: the sync they wait for
// holds no commit open. Each database owns a shared lifetime, so closing can
// cancel queued work without waiting for the thread to receive its message.

import { Worker } from 'node:worker_threads'

/** A checkpoint request belongs to one open database, even when another
 * database is opened later at the same path. */
export type Request = { id: number; path: string; state: Int32Array }

/** What the thread answers for a file it checkpointed. */
export type Done = { id: number; path: string; error?: string }

/** Checkpoint work owned by a database. Closing releases the owner's handle
 * before waiting for an already running checkpoint to release its own. */
export type Checkpoint = { run(): void; close(release: () => void): void }

type Wait = (state: Int32Array, index: number, value: number) => unknown

type File = { checkpoint(): void; close(): void }

let IDLE = 0, QUEUED = 1, RUNNING = 2, CLOSED = 4
let worker: Worker | undefined
let serial = 0

/** Outstanding work for one thread, identified by owner rather than path. */
export type Pending = {
  send(request: Request): void
  done(id: number): void
  failed(): void
}

/** Retain requests until their thread answers or exits. A failed thread leaves
 * live owners able to request work again; closed owners stay closed. */
export let pending = (send: (request: Request) => void): Pending => {
  let requests = new Map<number, Int32Array>()
  return {
    send: (request) => {
      requests.set(request.id, request.state)
      try {
        send(request)
      } catch (error) {
        requests.delete(request.id)
        throw error
      }
    },
    done: (id) => requests.delete(id),
    failed: () => {
      for (let state of requests.values()) {
        Atomics.and(state, 0, CLOSED)
        Atomics.notify(state, 0)
      }
      requests.clear()
    },
  }
}

let start = () => {
  let w = new Worker(new URL('./checkpoint_worker.ts', import.meta.url))
  w.unref()
  w.on('message', ({ id, path, error }: Done) => {
    requests.done(id)
    if (error) reportError(new Error(`checkpoint of ${path} failed: ${error}`))
  })
  let failed = false
  w.on('error', (error) => {
    failed = true
    reportError(error)
  })
  w.on('exit', (code) => {
    worker = undefined
    requests.failed()
    if (!failed) reportError(new Error(`checkpoint thread exited (${code})`))
  })
  return w
}

let requests = pending((request) => (worker ??= start()).postMessage(request))

/** Bind checkpoint requests to one database's lifetime. Commits only enqueue;
 * idle or queued work closes immediately. Only work already holding a file
 * must finish before close returns, independently of main-thread messages. */
export let checkpoint = (
  path: string,
  send: (request: Request) => void = requests.send,
  wait: Wait = Atomics.wait,
): Checkpoint => {
  let state = new Int32Array(new SharedArrayBuffer(4))
  return {
    run: () => {
      if (Atomics.compareExchange(state, 0, IDLE, QUEUED) != IDLE) return
      try {
        send({ id: ++serial, path, state })
      } catch (error) {
        Atomics.compareExchange(state, 0, QUEUED, IDLE)
        throw error
      }
    },
    close: (release) => {
      Atomics.or(state, 0, CLOSED)
      try {
        release()
      } finally {
        while (Atomics.load(state, 0) == (CLOSED | RUNNING)) {
          wait(state, 0, CLOSED | RUNNING)
        }
      }
    },
  }
}

/** Take a queued request before opening its file, and retain ownership through
 * the file's close, including failures. The thread supplies the file boundary;
 * in-process callers can exercise the same lifetime without starting it. */
export let perform = (request: Request, open: (path: string) => File): void => {
  let { path, state } = request
  if (Atomics.compareExchange(state, 0, QUEUED, RUNNING) != QUEUED) return
  try {
    let file = open(path)
    try {
      file.checkpoint()
    } finally {
      file.close()
    }
  } finally {
    Atomics.and(state, 0, CLOSED)
    Atomics.notify(state, 0)
  }
}
