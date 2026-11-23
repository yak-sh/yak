import { equal, test } from '@yaks/testing'
import { AccessError, InputError } from './refusal.ts'
import { printService, type ServicePorts } from './service.ts'

// The service's answer when what it reaches for throws `error`.
let answered = async (error: Error) => {
  let ports = new Proxy({}, {
    get: () => {
      throw error
    },
  }) as ServicePorts
  let res = await printService(
    new Request('https://printbound.test/service/order_status', {
      method: 'POST',
      headers: { 'x-yak-person': 'ada' },
      body: JSON.stringify({ order: 'o' }),
    }),
    ports,
  )
  return { status: res!.status, body: await res!.json() }
}

test('a refusal is said to the caller with its status', async () => {
  equal(await answered(new InputError('Bad address')), {
    status: 400,
    body: { error: { message: 'Bad address' } },
  })
  equal(await answered(new AccessError('PrintBound cannot reach Lulu')), {
    status: 403,
    body: { error: { message: 'PrintBound cannot reach Lulu' } },
  })
})
