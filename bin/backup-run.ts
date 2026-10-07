// The supervisor stays outside the backup's timeout and data directory. It
// hands the child the R2 key pair from the box's vault, and reports a failed
// exit through the same spool as other box processes, without opening either
// graph. A restore is a person's: it runs unbounded, and its failure is theirs
// to read, not a tracker bug.
import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'
import { vaultOf } from '../packages/cli/vault.ts'
import { reveal } from '@yaks/secrets'
import { fileURLToPath } from 'node:url'

let script = fileURLToPath(new URL('./backup', import.meta.url))
let restoring = Deno.args[0] == 'restore'
let data = Deno.env.get('YAK_DATA') || `${Deno.env.get('HOME')}/.yak`

let diagnostic = ''
let code = 1
try {
  // The values pass through this process into the child's environment and
  // nowhere else. A name the vault lacks falls to an exported variable of the
  // same name (reveal), which is how a restore away from the box takes them.
  let env: Record<string, string> = { YAK_BACKUP_BOUND: '1' }
  let vault = vaultOf(`${data}/yak.db`)
  let pair = ['YAK_BACKUP_R2_ACCESS_KEY_ID', 'YAK_BACKUP_R2_SECRET_ACCESS_KEY']
  for (let name of pair) {
    let value = await reveal(vault, name)
    if (value) env[name] = value
  }
  let child = new Deno.Command(restoring ? script : 'timeout', {
    args: restoring ? Deno.args : [
      '-k',
      '30',
      Deno.env.get('YAK_BACKUP_TIMEOUT') || '3600',
      script,
      ...Deno.args,
    ],
    env,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'piped',
  }).spawn()
  let decoder = new TextDecoder()
  let forwarded = child.stderr.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Keep only a bounded diagnostic tail, not the whole log.
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

if (code != 0 && !restoring) {
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
