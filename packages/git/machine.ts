// Exact command output over a lent Machine. The transport is a single base64
// JSON record, so line-oriented process tails never trim or corrupt Git bytes.
import type { Machine } from '@yaks/machine'
import type { Ran, Run } from './land.ts'

export let quote = (word: string): string =>
  "'" + word.replaceAll("'", "'\\''") + "'"
let dec = new TextDecoder()
let bytes = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** One command's full stdout and stderr, including binary bytes. */
export type MachineRan = {
  ok: boolean
  code: number
  out: Uint8Array
  err: Uint8Array
}
export let machineExec = async (
  machine: Machine,
  command: string,
  cwd?: string,
): Promise<MachineRan> => {
  let script = `import subprocess,json,base64
try:
 p=subprocess.run(['bash','-c',${JSON.stringify(command)}],capture_output=True)
 print(json.dumps(dict(code=p.returncode,out=base64.b64encode(p.stdout).decode(),err=base64.b64encode(p.stderr).decode())))
except Exception as e:
 print(json.dumps(dict(code=-1,out='',err=base64.b64encode(str(e).encode()).decode())))`
  let id = await machine.start('python3 -c ' + quote(script), cwd)
  for (;;) {
    let process = await machine.look(id)
    if (!process) throw new Error('Machine lost command ' + id)
    if (process.exit) {
      let lines = await machine.tail(id, 4)
      let line = lines.findLast((line) => line.startsWith('{'))
      if (process.exit.code != 0 || !line) {
        throw new Error('Machine command transport failed: ' + lines.join('\n'))
      }
      let result = JSON.parse(line)
      return {
        ok: result.code == 0,
        code: result.code,
        out: bytes(result.out),
        err: bytes(result.err),
      }
    }
    await new Promise((go) => setTimeout(go, machine.poll ?? 100))
  }
}

/** Git as land/receive's Run capability, without an implicit host subprocess. */
export let machineRun =
  (machine: Machine): Run => async (args, cwd): Promise<Ran> => {
    try {
      let ran = await machineExec(
        machine,
        'GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= SSH_ASKPASS= git ' +
          args.map(quote).join(' '),
        cwd,
      )
      return { ...ran, out: dec.decode(ran.out), err: dec.decode(ran.err) }
    } catch (error) {
      return { ok: false, code: -1, out: '', err: String(error) }
    }
  }

/** A JSON-valued filesystem operation performed on the machine, not the host. */
export let python = async <T>(machine: Machine, script: string): Promise<T> => {
  let ran = await machineExec(machine, 'python3 -c ' + quote(script))
  if (!ran.ok) throw new Error(dec.decode(ran.err))
  return JSON.parse(dec.decode(ran.out))
}
export let canonical = (path: string, machine: Machine): Promise<string> =>
  python(
    machine,
    `import os,json; print(json.dumps(os.path.realpath(${
      JSON.stringify(path)
    })))`,
  )
export let exists = (path: string, machine: Machine): Promise<boolean> =>
  python(
    machine,
    `import os,json
try:
 os.stat(${JSON.stringify(path)})
 print('true')
except FileNotFoundError:
 print('false')`,
  )

/** Hold an advisory machine-side lock while this caller renews its heartbeat.
 * A crashed caller stops renewing; even a surviving machine process releases
 * the lock after the bounded lease. Lock files themselves are never unlinked. */
export let machineLocked = async <T>(
  machine: Machine,
  file: string,
  change: () => Promise<T>,
  leaseMs = 10_000,
): Promise<T> => {
  let heartbeat = file + '.heartbeat-' + crypto.randomUUID()
  await machine.write(heartbeat, 'alive')
  let script = `import os,fcntl,time,sys
file,heartbeat,lease=sys.argv[1:]; lease=float(lease)/1000
lock=open(file,'a')
def fresh():
 try: return time.time()-os.stat(heartbeat).st_mtime < lease
 except FileNotFoundError: return False
while fresh():
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  print('locked',flush=True)
  while fresh(): time.sleep(min(lease/4,0.5))
  break
 except BlockingIOError: time.sleep(min(lease/4,0.5))
`
  let id = await machine.start(
    'python3 -c ' + quote(script) + ' ' + quote(file) + ' ' + quote(heartbeat) +
      ' ' + leaseMs,
  )
  let renewing = Promise.resolve()
  let failed: unknown
  let timer = setInterval(() => {
    renewing = renewing.then(() => machine.write(heartbeat, 'alive')).catch(
      (e) => {
        failed = e
      },
    )
  }, Math.max(10, leaseMs / 4))
  try {
    for (;;) {
      if (failed) throw failed
      if ((await machine.tail(id, 4)).includes('locked')) break
      let process = await machine.look(id)
      if (!process || process.exit) {
        throw new Error('Machine lock failed: ' + file)
      }
      await new Promise((go) => setTimeout(go, machine.poll ?? 100))
    }
    let result = await change()
    if (failed || (await machine.look(id))?.exit) {
      throw new Error('Machine lock lease expired: ' + file)
    }
    return result
  } finally {
    clearInterval(timer)
    await renewing
    await machine.kill(id, 'SIGKILL')
    await machineExec(machine, 'rm -f -- ' + quote(heartbeat))
  }
}
