import * as io from '@yaks/file/io'
import { command } from '@yaks/process/command'

/** Everything a headless turn lends the child process. The login is found
 * by the executable in its own configuration directory. */
export type Invocation = {
  command: string
  args: string[]
  env: Record<string, string>
  files?: Record<string, string>
  stdin?: string
  signal?: AbortSignal
}

/** Exit status and captured output of one headless turn. */
export type Output = { code: number; stdout: string; stderr: string }

/** Runs the executable in a private temporary directory. */
export type Run = (invocation: Invocation) => Promise<Output>

export let run: Run = async (call) => {
  call.signal?.throwIfAborted()
  let cwd = await io.makeTempDir({ prefix: 'yak-model-cli-' })
  try {
    for (let [name, contents] of Object.entries(call.files ?? {})) {
      let at = name.lastIndexOf('/')
      if (at > 0) {
        await io.mkdir(`${cwd}/${name.slice(0, at)}`, { recursive: true })
      }
      await io.writeTextFile(`${cwd}/${name}`, contents)
    }
    call.signal?.throwIfAborted()
    let child = command(call.command, {
      args: call.args,
      cwd,
      clearEnv: true,
      env: call.env,
      stdin: call.stdin == null ? 'null' : 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let stop = () => child.kill('SIGKILL')
    call.signal?.addEventListener('abort', stop, { once: true })
    let collected = child.output()
    try {
      if (call.signal?.aborted) stop()
      await child.started
      if (call.stdin != null) {
        let writer = child.stdin.getWriter()
        // An early CLI refusal can close stdin before it has read the prompt.
        await writer.write(new TextEncoder().encode(call.stdin))
          .then(() => writer.close()).catch(() => {})
      }
      let { code, stdout, stderr } = await collected
      call.signal?.throwIfAborted()
      let decode = new TextDecoder()
      return {
        code,
        stdout: decode.decode(stdout),
        stderr: decode.decode(stderr),
      }
    } finally {
      stop()
      await collected.catch(() => {})
      call.signal?.removeEventListener('abort', stop)
    }
  } finally {
    await io.remove(cwd, { recursive: true, force: true })
  }
}
