// The Wire object's release news (T-33005), held in memory: a platform
// deploy restarts the object and every stream resumes transparently, so the
// object remembers per session which VERSION it last spoke for and tells a
// stream that crossed a release its three lists moved — once per session,
// directly, off the log. The object is a plain class over a structural
// storage slice, so the fast tier constructs it with a Map and reads the SSE
// frames straight off the attach Response.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { VERSION } from '../../src/version.ts'
import { Wire } from './stream.ts'

let kv = () => {
  let m = new Map<string, unknown>()
  return {
    map: m,
    get: <T>(key: string) => Promise.resolve(m.get(key) as T | undefined),
    put: (key: string, value: unknown) => {
      m.set(key, structuredClone(value))
      return Promise.resolve()
    },
  }
}

let attached = async (wire: Wire, session: string) => {
  let res = await wire.attach(
    new Request('http://wire/open', {
      headers: { 'mcp-session-id': session },
    }),
  )
  let reader = res.body!.getReader()
  let bytes = new TextDecoder()
  return {
    // One frame, in arrival order: every send is its own chunk.
    read: async () => bytes.decode((await reader.read()).value),
  }
}

let drained = (wire: Wire) => {
  for (let held of [...wire.open]) wire.drop(held)
}

Deno.test('a stream resuming across a release hears the lists moved', async () => {
  let storage = kv()
  let wire = new Wire({ storage }, {})
  // The session last spoke under another release.
  storage.map.set('spoke', { abc: '0.0.0-before' })
  try {
    let ear = await attached(wire, 'abc')
    assertStringIncludes(await ear.read(), ': open')
    for (let list of ['tools', 'resources', 'prompts']) {
      let frame = await ear.read()
      assertStringIncludes(frame, `notifications/${list}/list_changed`)
      // Off the log: no id, so the session's cursor stays where it was.
      assertEquals(frame.includes('id:'), false)
    }
    assertEquals(
      (storage.map.get('spoke') as Record<string, string>).abc,
      VERSION,
    )
    // Once per session: the next attach is quiet — the probe line sent
    // through the log is the very next frame it hears.
    let again = await attached(wire, 'abc')
    assertStringIncludes(await again.read(), ': open')
    await wire.tell({ method: 'probe' })
    assertStringIncludes(await again.read(), 'probe')
  } finally {
    drained(wire)
  }
})

Deno.test('a session never spoken for is remembered silently', async () => {
  let storage = kv()
  let wire = new Wire({ storage }, {})
  try {
    let ear = await attached(wire, 'fresh')
    assertStringIncludes(await ear.read(), ': open')
    await wire.tell({ method: 'probe' })
    // No release news intervened: it just initialized and listed fresh.
    assertStringIncludes(await ear.read(), 'probe')
    assertEquals(
      (storage.map.get('spoke') as Record<string, string>).fresh,
      VERSION,
    )
  } finally {
    drained(wire)
  }
})
