// The process fixture for /proc-backed sessions: exec deno through a provider
// symlink so its comm matches production, without a fixture binary. The timer
// is load-bearing: an unresolved top-level await leaves deno's event loop empty.

let fake = async (name: string) => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-door-' })
  Deno.symlinkSync(Deno.execPath(), `${dir}/${name}`)
  let child = new Deno.Command(`${dir}/${name}`, {
    args: ['eval', 'setInterval(() => {}, 1000)'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  for (let i = 0; i < 200; i++) {
    try {
      if (
        Deno.readTextFileSync(`/proc/${child.pid}/comm`).trim() == name
      ) return child
    } catch { /* not exec'd yet */ }
    await new Promise((go) => setTimeout(go, 10))
  }
  child.kill('SIGKILL')
  await child.status
  throw new Error(`timed out waiting for the fake ${name} to exec`)
}

export let fakeClaude = () => fake('claude')
export let fakeCodex = () => fake('codex')
