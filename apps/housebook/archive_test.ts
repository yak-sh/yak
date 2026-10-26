import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { archive } from './archive.js'
import { documents } from './documents.js'

let request = (url = 'https://example.org/manual.pdf') =>
  new Request('https://app.invalid/housebook/archive', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
let fixture = (writes = true) => {
  let stored: { bytes: string; mime: string }[] = []
  return {
    stored,
    env: {
      STORE: {
        fetch: async (path: string, init?: RequestInit) => {
          if (path === '/me') return Response.json({ writes })
          let body = await new Response(init!.body).text()
          stored.push({
            bytes: body,
            mime: new Headers(init!.headers).get('content-type')!,
          })
          return Response.json({ eid: 'saved', mime: stored[0].mime })
        },
      },
    },
  }
}
let pdf = '%PDF-1.7\nmanual contents'
let f = fixture()
let saved = await archive(() =>
  Promise.resolve(
    new Response(pdf, {
      headers: { 'content-type': 'application/octet-stream' },
    }),
  )
)(request(), f.env)
let denied = fixture(false), calls = 0
let deniedResponse = await archive(() => {
  calls++
  return Promise.resolve(new Response(pdf))
})(request(), denied.env)
let html = fixture()
let htmlResponse = await archive(() =>
  Promise.resolve(
    new Response('<!doctype html><html>Download page</html>', {
      headers: { 'content-type': 'application/pdf' },
    }),
  )
)(request(), html.env)
let fail = fixture()
let failResponse = await archive(() =>
  Promise.resolve(new Response('not found', { status: 404 }))
)(request(), fail.env)

test('a downloaded manual stores its bytes and detected PDF type', async () => {
  assertEquals(saved.status, 200)
  assertEquals(await saved.json(), { eid: 'saved', mime: 'application/pdf' })
  assertEquals(f.stored, [{ bytes: pdf, mime: 'application/pdf' }])
})
test('a visitor without write access cannot download or store a manual', () => {
  assertEquals(deniedResponse.status, 403)
  assertEquals(calls, 0)
  assertEquals(denied.stored, [])
})
test('a download page and an unavailable file never become saved documents', () => {
  assertEquals(htmlResponse.status, 422)
  assertEquals(html.stored, [])
  assertEquals(failResponse.status, 502)
  assertEquals(fail.stored, [])
})

let kept = documents({
  upload: () => {},
  fetch: () =>
    Promise.resolve(Response.json({ eid: 'new', mime: 'image/jpeg' })),
})
let changed = await kept({ url: 'https://example.org/photo.jpg' }, {
  url: 'https://example.org/manual.pdf',
  blob: 'old',
  mime: 'application/pdf',
})
let previous = {
  url: 'https://example.org/manual.pdf',
  blob: 'old',
  mime: 'application/pdf',
}
let failure = documents({
  upload: () => {},
  fetch: () =>
    Promise.resolve(
      Response.json({ error: { message: 'Source unavailable; draft kept.' } }, {
        status: 502,
      }),
    ),
})
let error: Error | undefined
try {
  await failure({ url: 'https://example.org/new.pdf' }, previous)
} catch (e) {
  error = e as Error
}

test('changing a document URL replaces its old bytes and MIME while retaining its source', () => {
  assertEquals(changed, {
    url: 'https://example.org/photo.jpg',
    blob: 'new',
    mime: 'image/jpeg',
    reference: false,
  })
})
test('failed downloads leave the saved document untouched and reject the form save', () => {
  assertEquals(error?.message, 'Source unavailable; draft kept.')
  assertEquals(previous, {
    url: 'https://example.org/manual.pdf',
    blob: 'old',
    mime: 'application/pdf',
  })
})
