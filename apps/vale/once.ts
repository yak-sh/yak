// A one-time store read for a page that keeps its current view while the
// store wakes. An unanswered read is never an empty result: the gate uses an
// empty result to decide that this person has no hero yet.

type Get = (url: URL, init: RequestInit) => Promise<Response>

let pause = () => new Promise<void>((done) => setTimeout(done, 1000))

export let once = async <T>(
  url: URL,
  get: Get = fetch,
  rest: () => Promise<void> = pause,
): Promise<T[]> => {
  for (;;) {
    let answer: Response
    try {
      answer = await get(url, { signal: AbortSignal.timeout(8000) })
    } catch (e) {
      console.warn('mossvale store:', url.search, e)
      await rest()
      continue
    }
    if (answer.status >= 500) {
      console.warn('mossvale store:', url.search, answer.status)
      await rest()
      continue
    }
    if (!answer.ok) {
      throw new Error(`${answer.status} ${answer.statusText}`)
    }
    let rows: unknown = await answer.json()
    if (!Array.isArray(rows)) throw new Error('store query did not answer rows')
    return rows as T[]
  }
}
