// Own the reader behind the stream given to R2. The binding may still have
// that stream locked when it rejects, so cleanup acts on our reader directly.
let owned = (source: ReadableStream<Uint8Array>) => {
  let reader = source.getReader()
  return {
    body: new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        let got = await reader.read()
        if (got.done) controller.close()
        else controller.enqueue(got.value)
      },
      cancel: (reason) => reader.cancel(reason),
    }),
    cancel: (reason?: unknown) => reader.cancel(reason),
  }
}

// R2 uploads and HTTP responses both require the Worker's native stream
// length. Retain both ends and the pipe, so a rejected upload can stop it
// even before the binding consumes its body.
type Exact = (
  length: number,
) => TransformStream<Uint8Array, Uint8Array> | undefined

let exact: Exact = (length) => {
  let Fixed = (globalThis as {
    FixedLengthStream?: new (
      length: number,
    ) => TransformStream<Uint8Array, Uint8Array>
  }).FixedLengthStream
  return Fixed && new Fixed(length)
}

export let fixed = (
  stream: ReadableStream<Uint8Array>,
  length: number,
  make = exact,
) => {
  let input = owned(stream)
  let exact = make(length)
  if (!exact) return { ...input, done: Promise.resolve() }
  let abort = new AbortController()
  let done = input.body.pipeTo(exact.writable, { signal: abort.signal })
  done.catch(() => {})
  let output = exact.readable
  return {
    body: output,
    done,
    cancel: async (reason?: unknown) => {
      abort.abort(reason)
      await Promise.allSettled([input.cancel(reason), output.cancel(reason)])
      await done.catch(() => {})
    },
  }
}
