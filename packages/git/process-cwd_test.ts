// The root-owned reader's command interface must admit only a single owned
// process directory, even when its caller can invoke it through sudo.
import { equal, test } from '@yaks/testing'

let read = (args: string[], uid = String(Deno.uid())) =>
  new Deno.Command('/usr/bin/python3', {
    args: [
      '-I',
      new URL('./process-cwd.py', import.meta.url).pathname,
      ...args,
    ],
    env: { SUDO_UID: uid },
    stdout: 'piped',
    stderr: 'piped',
  }).output()

test('the privileged cwd reader accepts one owned PID', async () => {
  let result = await read([String(Deno.pid)])
  equal(result.success, true)
  equal(
    new TextDecoder().decode(result.stdout).trimEnd(),
    await Deno.realPath(Deno.cwd()),
  )
})

test('the privileged cwd reader refuses paths and extra arguments', async () => {
  for (
    let args of [
      [],
      ['0'],
      ['-1'],
      ['../self'],
      [`${Deno.pid}/cwd`],
      [String(Deno.pid), '/etc/passwd'],
    ]
  ) {
    let result = await read(args)
    equal(result.success, false)
    equal(result.stdout.length, 0)
  }
})

test('the privileged cwd reader requires a numeric UID owning the process', async () => {
  for (let uid of ['', '-1', 'unknown', String(Deno.uid()! + 1)]) {
    let result = await read([String(Deno.pid)], uid)
    equal(result.success, false)
    equal(result.stdout.length, 0)
  }
})
