import { assertRejects } from '@std/assert'
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { DocumentInputError, start } from './document.ts'
import { preparationRecovery } from './preparation-errors.ts'
import { products } from './layout.ts'
import {
  documentStatus,
  prepareCommand,
  prepareStep,
} from './preparation-service.ts'
import { InputError } from './refusal.ts'
import { query } from './orders.ts'
import type { PreparationRow } from './preparation-service.ts'
import type { ServicePorts, Who } from './service.ts'
import manifest from './vocab.json' with { type: 'json' }

let fixture = async () => {
  let vocab = loadVocab({
    $defs: {
      ...Object.fromEntries(
        Object.entries(manifest.$defs).filter(([name]) =>
          [
            'print_preparation',
            'print_preparation_failed',
            'print_preparation_done',
            'print_document',
          ].includes(name)
        ),
      ),
      tool: { component: true, properties: { name: { type: 'string' } } },
      call: {
        component: true,
        properties: {
          to: { type: 'string' },
          source: { type: 'string' },
          args: { type: 'object' },
        },
      },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  g.install()
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    tool: { name: 'print_prepare_step' },
  }])
  let store = {
    async fetch(path: string, init?: RequestInit) {
      let url = new URL(path, 'https://fixture.invalid')
      if (url.pathname === '/query') {
        return Response.json(
          await g.read(url.searchParams.get('q')!),
        )
      }
      try {
        return Response.json(
          await g.apply(JSON.parse(String(init?.body)).entities),
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'Stale') {
          return Response.json({ error: { name: 'Stale' } }, { status: 409 })
        }
        throw error
      }
    },
  }
  return store
}

test('a delayed revoked preparation cannot fail a newer reconnected attempt', async () => {
  let store = await fixture(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  let ports = {
    store,
    preview: true,
    now: () => '2026-11-10T00:00:00Z',
    begin: () =>
      Promise.resolve(
        start(products.text, { title: 'My book', markdown: 'Kept text' }),
      ),
    verifyPreparation: async () => {
      entered.resolve()
      await release.promise
      throw new InputError('Reconnect the source')
    },
  } as unknown as ServicePorts
  let who: Who = {
    person: crypto.randomUUID(),
    source: crypto.randomUUID(),
    seller: crypto.randomUUID(),
    authority: 'old',
  }
  let job = await prepareCommand(ports, { title: 'My book' }, who)
  let delayed = prepareStep(ports, job.id)
  await entered.promise
  await prepareCommand(ports, { document: job.id }, {
    ...who,
    authority: 'fresh',
  })
  release.resolve()
  await delayed
  let status = await documentStatus(ports, { document: job.id }, who)
  equal(status.pending, true)
  equal('error' in status, false)
})

test('a prior browser restores a pending guest document to its person without granting another buyer', async () => {
  let store = await fixture(), old = crypto.randomUUID()
  let ports = {
    store,
    preview: true,
    begin: () =>
      Promise.resolve(
        start(products.text, { title: 'Saved book', markdown: 'Kept text' }),
      ),
  } as unknown as ServicePorts
  let guest: Who = {
    via: old,
    source: crypto.randomUUID(),
    seller: crypto.randomUUID(),
  }
  let job = await prepareCommand(ports, { title: 'Saved book' }, guest)
  let alice: Who = {
    ...guest,
    person: crypto.randomUUID(),
    via: crypto.randomUUID(),
    browsers: [old],
  }
  let bob: Who = {
    ...guest,
    person: crypto.randomUUID(),
    via: old,
    browsers: [],
  }
  await assertRejects(
    () => documentStatus(ports, { document: job.id }, bob),
    InputError,
  )
  equal(
    (await documentStatus(ports, { document: job.id }, alice)).pending,
    true,
  )
  equal((await prepareCommand(ports, { document: job.id }, alice)).id, job.id)
  await assertRejects(
    () =>
      documentStatus(ports, { document: job.id }, { ...bob, browsers: [old] }),
    InputError,
  )
  let [saved] = await query<PreparationRow>(store, `.entity.eid=${job.id}`)
  equal(saved.print_preparation.person, alice.person)
  equal('browsers' in saved.print_preparation, false)
})

test('preparation refuses invalid input with detail and keeps unexpected diagnostics out of customer status', async () => {
  for (
    let error of [
      new InputError('Reconnect this source before resuming.'),
      new DocumentInputError('Page 3 needs an image with at least 300 DPI.'),
      new Error('<html><h1>Private upstream diagnostic</h1></html>', {
        cause: new Error('Original transport failure'),
      }),
    ]
  ) {
    let store = await fixture(), reports: unknown[] = []
    let ports = {
      store,
      preview: true,
      now: () => '2026-11-10T00:00:00Z',
      begin: () =>
        Promise.resolve(
          start(products.text, { title: 'Kept book', markdown: 'Saved words' }),
        ),
      verifyPreparation: () => Promise.reject(error),
      report: (cause: unknown) => {
        reports.push(cause)
        return Promise.resolve()
      },
    } as unknown as ServicePorts
    let who: Who = {
      person: crypto.randomUUID(),
      source: crypto.randomUUID(),
      seller: crypto.randomUUID(),
    }
    let job = await prepareCommand(ports, { title: 'Kept book' }, who),
      escaped: unknown
    try {
      await prepareStep(ports, job.id)
    } catch (cause) {
      escaped = cause
    }
    let expected = error instanceof InputError ||
      error instanceof DocumentInputError
    let status = await documentStatus(ports, { document: job.id }, who)
    equal(status.pending, false)
    equal(
      'error' in status ? status.error : undefined,
      expected ? error.message : preparationRecovery,
    )
    equal(escaped, expected ? undefined : error)
    equal(reports, expected ? [] : [error])
    if (!expected) {
      // A pre-upgrade mark may still contain the original upstream body.
      await store.fetch('/apply', {
        method: 'POST',
        body: JSON.stringify({
          entities: [{
            entity: { eid: job.id },
            print_preparation_failed: { reason: error.message, refusal: null },
          }],
        }),
      })
      let legacy = await documentStatus(ports, { document: job.id }, who)
      equal('error' in legacy ? legacy.error : undefined, preparationRecovery)
    }
    let resumed = await prepareCommand(ports, { document: job.id }, who)
    equal(resumed.id, job.id)
    equal(resumed.pending, true)
  }
})
