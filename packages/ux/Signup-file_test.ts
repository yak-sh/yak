import { equal, test } from '@yaks/testing'
import { signupBlob, upload } from './Signup-file.ts'

test('file uploads resolve alongside the form, including other apps and origins', () => {
  let base = 'https://church.example/join/'
  equal(
    signupBlob('../directory/api/form/kids%20club', 'resume', base),
    'https://church.example/directory/api/blob?form=kids+club&question=resume',
  )
  equal(
    signupBlob(
      'https://other.example/app/api/form/signup?x=1#here',
      'photo',
      base,
    ),
    'https://other.example/app/api/blob?form=signup&question=photo',
  )
})

test('the file door receives bytes, mime and its encoded name, and returns the reference', async () => {
  let file = new File(['hello'], 'résumé.txt', { type: 'text/plain' })
  let result = await upload(
    'https://other.example/app/api/form/signup',
    'resume',
    file,
    async (at, init) => {
      let req = new Request(at, init)
      equal(
        req.url,
        'https://other.example/app/api/blob?form=signup&question=resume',
      )
      equal(req.method, 'POST')
      equal(req.headers.get('x-yak-name'), encodeURIComponent('résumé.txt'))
      equal(req.headers.get('content-type'), 'text/plain')
      equal(await req.text(), 'hello')
      return Response.json({ eid: 'file-reference', url: '/private/file' })
    },
  )
  equal(result, { eid: 'file-reference' })
})
