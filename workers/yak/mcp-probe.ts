import { assertEquals } from '@std/assert'
// The connector's contract, held in workerd (probe.ts boots the kernel): an
// MCP session initialized and its tools listed, a space and an app born
// through the sugar and served through the kernel, a bundle written and
// read back through the graph tier, and a route that threw reaching the
// agent as the next reply's unseen section — once — then through
// app_errors.
// A client's own reading of the published schema: the tool list is JSON
// Schema, so what proves it describes a batch is a JSON Schema validator.

// The connector's face, on BOTH doors (T-34415): the same name, line and
// square picture whether the caller has signed in or not, because a directory
// reviewer and a connector form both read it before any grant exists.
export let facing = (info: Record<string, unknown>) => {
  assertEquals(info.name, 'yaks.app')
  assertEquals(info.title, 'yaks.app')
  assertEquals(info.websiteUrl, 'https://yaks.app')
  assertEquals(info.icons, [
    {
      src: 'https://yaks.app/connector.svg',
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
    {
      src: 'https://yaks.app/connector-512.png',
      mimeType: 'image/png',
      sizes: ['512x512'],
    },
  ])
}

// The eid a batch minted under an alias, read off the batch AS APPLIED
// (T-33812): graph_apply answers every entity the write touched, each carrying
// the `$alias` the batch called it by.
export let minted = (applied: string, alias: string) =>
  (JSON.parse(applied) as { entity: { eid: string }; $alias?: string }[])
    .find((b) => b.$alias == alias)!.entity.eid

// What a client says when it opens the connection. The protocol machine is the
// SDK's now (T-33812) and it holds a client to the spec's own shape, which
// every client sends and only a test would leave out.
export let HELLO = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'probe', version: '0' },
}

export let GUIDE = 'https://yaks.app/guide.md'
export let APPS = 'ui://yaks/apps'
export let ERRORS = 'ui://yaks/errors'

// The base64url a PKCE challenge is written in.
export let b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

// An SSE stream held open, as the text heard so far: a test asserts on what
// has arrived, forgets it, and cancels when it is done.
export let hearing = (res: Response) => {
  let heard = ''
  let bytes = new TextDecoder()
  let reader = res.body!.getReader()
  let reading = (async () => {
    try {
      for (;;) {
        let { done, value } = await reader.read()
        if (done) return
        heard += bytes.decode(value, { stream: true })
      }
    } catch { /* cancelled with the test */ }
  })()
  return {
    said: () => heard,
    forget: () => heard = '',
    stop: async () => {
      await reader.cancel().catch(() => {})
      await reading
    },
  }
}

// An app's own mailbox at the agent door (T-34149). Mail already rode the
// generic tier — a letter is `doc` + `mail` + `deliver` and `.mail!` reads one
// back — so what is held here is the two things the tools add: the SCOPE, said
// where a model chooses (the block above), and the two verbs answering bundles
// through the doors graph_apply and graph_query already use, guard and all.
export type Letter = {
  entity: { eid: string }
  doc: { title: string; body: string }
  mail: { from?: string; to?: string }
  deliver?: { to: string }
  delivered?: { at: string; via: string }
  bounced?: { at: string; reason: string }
}
