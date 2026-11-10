import { equal, test } from '@yaks/testing'
import { pdfDoor } from './pdf.ts'
import type { Role } from './directory.ts'

let calls: Request[] = []
let render = (page: string, role: Role | null = 'editor') =>
  pdfDoor({
    req: new Request(
      'https://book.yaks.app/api/pdf?page=' + page + '&render=1',
      { method: 'POST', body: 'pdf-bytes' },
    ),
    path: '/pdf',
    who: { person: 'customer', role },
    env: {
      RASTER: {
        fetch: (req) => {
          calls.push(req)
          return Promise.resolve(
            Response.json({ pages: 3, image: 'composed-page' }),
          )
        },
      },
    },
    refuse: () => Promise.resolve(new Response('Not allowed', { status: 403 })),
    json: (status, code) => Response.json({ error: { code } }, { status }),
  })

test('the app PDF door keeps page selection and bytes on the existing raster boundary', async () => {
  let res = await render('2')
  equal(await res!.json(), { pages: 3, image: 'composed-page' })
  equal(calls.length, 1)
  equal(calls[0].url, 'https://raster/pdf?page=2&render=1')
  equal(await calls[0].text(), 'pdf-bytes')
})

test('an anonymous or read-only page cannot invoke the app server PDF capability', async () => {
  equal((await render('1', null))!.status, 403)
  equal((await render('1', 'viewer'))!.status, 403)
  equal((await render('0'))!.status, 400)
  equal(calls.length, 1)
})
