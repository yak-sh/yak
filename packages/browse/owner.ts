// Start identifying this page's write owner while its vocabulary is loading.
// Only boot may consume that in-flight read. Outbox checks always ask again:
// an account change must never replay writes as the owner of a prior request.
// A host that names no person answers no owner: its page reads, and refuses
// writes (outbox.ts). Only a failed or malformed answer is an error.
export let ownerReads = (
  request: (url: string) => Promise<Response> = (url) => fetch(url),
) => {
  let first: { url: string; answer: Promise<string | undefined> } | undefined
  let fresh = async (url: string) => {
    let response = await request(url)
    if (!response.ok) throw new Error('Could not identify the write owner')
    let identity = (await response.json()).owner
    if (identity == null) return undefined
    if (typeof identity !== 'string' || !identity) {
      throw new Error('Could not identify the write owner')
    }
    return identity
  }
  return {
    fresh,
    begin: (url: string) => {
      if (first) return
      let answer = fresh(url)
      // Boot observes a failure after vocabulary/module evaluation finishes.
      // The eagerly started request must not reject unhandled in the meantime.
      void answer.catch(() => {})
      first = { url, answer }
    },
    initial: (url: string) => {
      let started = first
      first = undefined
      return started?.url == url ? started.answer : fresh(url)
    },
  }
}
export let writeOwner = ownerReads()
