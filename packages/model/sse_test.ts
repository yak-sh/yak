import { equal, test } from '@yaks/testing'
import { jsonFrames } from './sse.ts'

let fault = (kind: string, message: string) => new Error(`${kind}: ${message}`)

test('SSE distinguishes the provider completion sentinel from ordinary EOF', async () => {
  for (let ending of ['', 'data: [DONE]\n\n', 'data: [DONE]']) {
    let done = 0
    let body = new Response('data: {"chunk":"audio"}\n\n' + ending).body!
    let events = []
    for await (let e of jsonFrames(body, fault, undefined, () => done++)) {
      events.push(e)
    }
    equal(events, [{ chunk: 'audio' }])
    equal(done, ending ? 1 : 0)
  }
})
