// The process fixture for the /proc door: exec deno through a `claude` symlink
// so its comm matches production, without a fixture binary. The timer is
// load-bearing: an unresolved top-level await leaves deno's event loop empty.

export let fakeClaude = async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-door-' })
  Deno.symlinkSync(Deno.execPath(), `${dir}/claude`)
  let child = new Deno.Command(`${dir}/claude`, {
    args: ['eval', 'setInterval(() => {}, 1000)'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  for (let i = 0; i < 200; i++) {
    try {
      if (
        Deno.readTextFileSync(`/proc/${child.pid}/comm`).trim() == 'claude'
      ) return child
    } catch { /* not exec'd yet */ }
    await new Promise((go) => setTimeout(go, 10))
  }
  child.kill('SIGKILL')
  await child.status
  throw new Error('timed out waiting for the fake claude to exec')
}
