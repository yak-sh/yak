/** A suite keeps imports warm in one child; each request creates and disposes
 * its own fixture. Only CPU samples cross the process boundary. */
export async function* lines(stream: ReadableStream<Uint8Array>) {
  let pending = '', decoder = new TextDecoder()
  for await (let chunk of stream) {
    pending += decoder.decode(chunk, { stream: true })
    let end: number
    while ((end = pending.indexOf('\n')) >= 0) {
      yield pending.slice(0, end)
      pending = pending.slice(end + 1)
    }
  }
  pending += decoder.decode()
  if (pending) yield pending
}

export let collector = (
  args: string[],
  root?: string,
  env?: Record<string, string>,
) => {
  let child: Deno.ChildProcess | undefined
  let writer: WritableStreamDefaultWriter<Uint8Array>
  let output: AsyncGenerator<string>
  return {
    collect: async (): Promise<unknown> => {
      if (!child) {
        child = new Deno.Command(Deno.execPath(), {
          args: ['run', '-A', ...args, '--serve'],
          cwd: root,
          env,
          stdin: 'piped',
          stdout: 'piped',
          stderr: 'inherit',
        }).spawn()
        writer = child.stdin.getWriter()
        output = lines(child.stdout)
      }
      await writer.write(new TextEncoder().encode('{}\n'))
      while (true) {
        let line = await output.next()
        if (line.done) {
          let status = await child.status
          throw new Error(
            `Benchmark collector exited (${status.code}): ${args}`,
          )
        }
        if (!line.value.startsWith('BENCH_RESULT=')) {
          console.error(line.value)
          continue
        }
        let result = JSON.parse(line.value.slice('BENCH_RESULT='.length))
        if (result.error) throw new Error(result.error)
        return result.value
      }
    },
    close: async () => {
      if (!child) return
      await writer.close().catch(() => {})
      await child.status
      await output.return(undefined)
      child = undefined
    },
  }
}

export let serve = async (work: () => Promise<unknown>) => {
  if (!Deno.args.includes('--serve')) {
    console.log(JSON.stringify(await work()))
    return
  }
  for await (let _line of lines(Deno.stdin.readable)) {
    let result
    try {
      result = { value: await work() }
    } catch (error) {
      result = { error: error instanceof Error ? error.stack : String(error) }
    }
    console.log(`BENCH_RESULT=${JSON.stringify(result)}`)
  }
}
