// A phase's lifeline. Its runner closes the pipe with one byte after the
// process group settles. If the runner dies outright, the pipe closes empty
// and this separate session ends every process the phase started.

if (import.meta.main) {
  let group = Number(Deno.args[0])
  let reader = Deno.stdin.readable.getReader()
  let done = await reader.read()
  if (done.value?.[0] === 1) Deno.exit(0)

  console.error(`test runner exited; ending process group ${group}`)
  try {
    Deno.kill(-group, 'SIGTERM')
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  try {
    Deno.kill(-group, 'SIGKILL')
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}
