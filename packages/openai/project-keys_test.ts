import { equal, test, throws } from '@yaks/testing'
import { projectKey } from './project-keys.ts'

test('project key creation uses the project service account API', async () => {
  let key = await projectKey(
    'admin-credential',
    'proj_example',
    'platform voice',
    async (url, init) => {
      let req = new Request(url, init)
      equal(
        req.url,
        'https://api.openai.com/v1/organization/projects/proj_example/service_accounts',
      )
      equal(req.method, 'POST')
      equal(req.headers.get('authorization'), 'Bearer admin-credential')
      equal(req.redirect, 'error')
      equal(await req.json(), { name: 'platform voice' })
      return Response.json({ api_key: { value: 'sk-project-credential' } })
    },
  )
  equal(key, 'sk-project-credential')
})

test('project key creation reports the upstream status without exposing the body', async () => {
  await throws(
    () =>
      projectKey(
        'admin-credential',
        'proj_example',
        'platform voice',
        () =>
          Promise.resolve(new Response('admin-credential', { status: 403 })),
      ),
    /^OpenAI project credential request returned 403$/,
  )
})
