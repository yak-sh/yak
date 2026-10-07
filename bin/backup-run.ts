// The supervisor stays outside the backup's timeout and data directory. It
// reports a failed exit through the same spool as other box processes, without
// opening either graph. The bounded child keeps its existing cleanup traps.
import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'
import { fileURLToPath } from 'node:url'

let script = fileURLToPath(new URL('./backup', import.meta.url))
let diagnostic = ''
let code = 1
try {
  let child = new Deno.Command('timeout', {
    args: [
      '-k',
      '30',
      Deno.env.get('YAK_BACKUP_TIMEOUT') || '1800',
      script,
      ...Deno.args,
    ],
    env: { YAK_BACKUP_BOUND: '1' },
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'piped',
  }).spawn()
  let decoder = new TextDecoder()
  let forwarded = child.stderr.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Keep only a bounded diagnostic tail, not the dump or the whole log.
        diagnostic = (diagnostic + decoder.decode(chunk, { stream: true }))
          .slice(-8192)
        controller.enqueue(chunk)
      },
    }),
  ).pipeTo(Deno.stderr.writable, { preventClose: true })
  let status = await child.status
  await forwarded
  diagnostic += decoder.decode()
  code = status.code
} catch (error) {
  diagnostic = String(error)
}

if (code != 0) {
  try {
    let path = configPath()
    await reporter(path ? read(path) : {}, undefined, await revision())(
      new Error(`backup failed (exit ${code}): ${diagnostic.trim()}`),
      { during: { kind: 'backup' }, tags: { job: 'backup', exit_code: code } },
    )
  } catch (error) {
    // Reporting must never turn a failed backup into a successful cron job.
    console.error('backup: reporting failed —', error)
  }
}
Deno.exit(code)
