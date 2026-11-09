// A browser reads a package's file with fetch: its loader imports neither text
// nor bytes, so @yaks/ui's sheets would never load on a page.
import { equal, test } from '@yaks/testing'
import { bytes, text } from './asset.ts'

// Each read is started without the `Deno` global, as a page starts it, with
// fetch answering `body` for the address it was asked.
let browser = async <T>(read: () => Promise<T>, body: string, status = 200) => {
  let host = globalThis as Record<string, unknown>
  let deno = Object.getOwnPropertyDescriptor(host, 'Deno')!
  let fetching = globalThis.fetch
  let asked: string[] = []
  globalThis.fetch = (url) => {
    asked.push(String(url))
    return Promise.resolve(new Response(body, { status }))
  }
  delete host.Deno
  let reading
  try {
    reading = read()
  } finally {
    Object.defineProperty(host, 'Deno', deno)
  }
  try {
    return { got: await reading.catch((e: Error) => e.message), asked }
  } finally {
    globalThis.fetch = fetching
  }
}

let at = new URL('https://yaks.app/__packages/h/resources/@yaks/ui/Card.css')

test('a page fetches a package file as text', async () =>
  equal(await browser(() => text(at), '.Card{}'), {
    got: '.Card{}',
    asked: [at.href],
  }))

test('a page fetches a package file as bytes', async () =>
  equal(await browser(async () => [...await bytes(at)], 'yak'), {
    got: [121, 97, 107],
    asked: [at.href],
  }))

test('a file the page cannot fetch is a failure, not its error page', async () =>
  equal(await browser(() => text(at), 'not found', 404), {
    got: `${at.href} answered 404`,
    asked: [at.href],
  }))
