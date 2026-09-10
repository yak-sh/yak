// A hosted shell's identity is its call entry, not the effectsd process. Reuse
// the fleet's detached scope/pidfile/exit watcher; keep the complete streams on
// disk and publish one bounded result only when the shell has ended. Nothing
// in the recovery arm launches a command, even if birth left no pidfile.
import { dirOf, launch, type Store, watch } from '@yaks/process'
import type { ToolOutcome } from './harness_tools.ts'

export type HostedShell = {
  entry: string
  command: string
  cwd: string
  env: Record<string, string>
  timeout: number
  limit: number
  dir?: string
  signal?: AbortSignal
  resume?: boolean
}

// What a call reports when the runner died while it was in flight. It is a
// tool RESULT, never a session failure: the model reads it, inspects the world
// and decides whether the work already happened.
export let interrupted =
  'runner restarted mid-call; operation outcome is ambiguous; ' +
  'inspect state before retrying'

let vanished = `${interrupted} (the process is gone without an exit record)`

let read = (path: string, limit: number) => {
  let file
  try {
    file = Deno.openSync(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return ''
    throw error
  }
  try {
    let size = file.statSync().size
    let bytes = new Uint8Array(Math.min(size, limit))
    let at = 0
    while (at < bytes.length) {
      let n = file.readSync(bytes.subarray(at))
      if (!n) break
      at += n
    }
    let text = new TextDecoder().decode(bytes.subarray(0, at))
    return text +
      (size > limit ? `\n[… full output saved to ${path} (${size} bytes)]` : '')
  } finally {
    file.close()
  }
}

export let hostedShell = async (o: HostedShell): Promise<ToolOutcome> => {
  o.signal?.throwIfAborted()
  // Entry ids are trusted graph coordinates, never command text or a path.
  if (!/^[\w-]+$/.test(o.entry)) throw new Error('invalid shell entry id')
  let dir = o.dir ?? `${dirOf()}/calls`
  let path = `${dir}/${o.entry}`
  let store: Store = {
    // The call/result already ARE our durable graph rows. The process package
    // owns the runtime files, not a second transcript alongside this one.
    apply: (bundles) => bundles,
    running: () => [{ entity: { eid: o.entry }, process: { pid: null } }],
    services: () => [],
  }
  let opts = { eid: o.entry, dir, poll: 100, stream: false }
  let run = o.resume ? (await watch(store, opts))[0] : await launch(store, {
    // timeout is inside the detached scope, so its deadline survives the
    // runner too. Its own group covers every descendant of the command.
    command: 'timeout',
    args: [
      '--signal=KILL',
      `${o.timeout / 1000}s`,
      '/bin/bash',
      '-c',
      o.command,
    ],
    cwd: o.cwd,
    env: o.env,
  }, opts)
  let abort = () => {
    // The pidfile's child is timeout, which leads the command's process group.
    // Leave the wrapper alive to report the ending, as sessions.ts does.
    if (run.pid > 0) {
      try {
        Deno.kill(-run.pid, 'SIGKILL')
      } catch {
        try {
          Deno.kill(run.pid, 'SIGKILL')
        } catch { /* already ended */ }
      }
    }
  }
  o.signal?.addEventListener('abort', abort, { once: true })
  if (o.signal?.aborted) abort()
  try {
    let code = await run.done
    o.signal?.throwIfAborted()
    let output = read(`${path}.out`, o.limit)
    let stderr = read(`${path}.err`, o.limit)
    if (code == null) {
      // No `error` facet: an error component on an entry is what fails a
      // Session (entry_log.ts). This is an answer the model gets to act on.
      return {
        output: `${vanished}${output ? `\n${output}` : ''}`,
        failed: true,
        facets: { ...stderr ? { stderr: { text: stderr } } : {} },
      }
    }
    if (code == 124 || code == 137) {
      stderr = `[killed; shell deadline ${o.timeout}ms]\n${stderr}`
    }
    return {
      output,
      failed: code != 0,
      facets: { exit: { code }, ...stderr ? { stderr: { text: stderr } } : {} },
    }
  } finally {
    o.signal?.removeEventListener('abort', abort)
  }
}
