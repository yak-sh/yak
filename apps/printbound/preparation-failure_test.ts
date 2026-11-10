import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { idDoc } from '@yaks/id/vocab'
import { CallError, runner, toolEid } from '@yaks/tools'
import { toolsDoc } from '@yaks/tools/vocab'
import { executionComputed } from '@yaks/tools/state'
import { start } from './document.ts'
import { products } from './layout.ts'
import { documentStatus, prepareCommand } from './preparation-service.ts'
import type { ServicePorts, Who } from './service.ts'
import manifest from './vocab.json' with { type: 'json' }

for (
  let error of [
    new Error('Worker exceeded CPU time limit.'),
    new CallError('access', 'Command access was revoked'),
  ]
) {
  test(`native ${error.name} stops its preparation and preserves the same resumable job`, async () => {
    let definitions = Object.fromEntries(
      Object.entries(manifest.$defs).filter(([name]) =>
        name.startsWith('print_preparation') || name === 'print_document'
      ),
    )
    let vocab = loadVocab([toolsDoc, kernelDoc, provenanceDoc, idDoc, {
      $defs: definitions,
    }], [kernelKeywords])
    let rules = Object.entries(definitions).flatMap(([name, def]) =>
      'rule' in def && def.rule && 'match' in def
        ? [{ name, match: String(def.match) }]
        : []
    )
    let g = graph({
      vocab,
      storage: ram(vocab, { computed: executionComputed }),
      plugins: [{ name: 'preparation', declared: rules }],
    })
    g.install()
    let reported: unknown[] = []
    let native = runner(g, {
      tools: [{
        name: 'print_prepare_step',
        description: 'Fixture hard failure',
        inputSchema: { type: 'object', properties: {} },
        run: () => {
          throw error
        },
      }],
      report: (error) => {
        reported.push(error)
      },
    })
    await native.ensure()
    let job = crypto.randomUUID(), call = crypto.randomUUID()
    let who: Who = {
      person: crypto.randomUUID(),
      source: crypto.randomUUID(),
      seller: crypto.randomUUID(),
    }
    let state = start(products.text, {
      title: 'Saved book',
      markdown: 'Kept text',
    })
    await g.apply([{
      entity: { eid: job },
      print_preparation: {
        ...who,
        state,
        run: crypto.randomUUID(),
        continuation: call,
      },
    }])
    let landed = await native.call({
      entity: { eid: call },
      call: { to: toolEid('print_prepare_step'), source: job, args: {} },
    })
    let store = {
      async fetch(path: string, init?: RequestInit) {
        let url = new URL(path, 'https://fixture.invalid')
        if (url.pathname === '/query') {
          return Response.json(await g.read(url.searchParams.get('q')!))
        }
        return Response.json(
          await g.apply(JSON.parse(String(init?.body)).entities),
        )
      },
    }
    let ports = { store, preview: true } as unknown as ServicePorts
    let failed = await documentStatus(ports, { document: job }, who)
    equal(failed.pending, false)
    equal('error' in failed ? failed.error : undefined, error.message)
    equal(reported.length, error instanceof CallError ? 0 : 1)
    let resumed = await prepareCommand(ports, { document: job }, who)
    equal(resumed.id, job)
    equal(resumed.pending, true)
    let fault = landed.find((row) => row.exception || row.refusal)!
    await g.apply([{ ...fault, entity: { eid: crypto.randomUUID() } }], {
      trusted: true,
    })
    equal((await documentStatus(ports, { document: job }, who)).pending, true)
    let [saved] = await g.read(`.entity.eid=${job}`)
    equal((saved.print_preparation as { state: unknown }).state, state)
    equal(saved.print_preparation_failed, undefined)
    let current =
      (saved.print_preparation as { continuation: string }).continuation
    equal(current === call, false)
    await g.apply([{
      entity: { eid: current },
      interrupted: { code: 'transport' },
    }], { trusted: true })
    let interrupted = await documentStatus(ports, { document: job }, who)
    equal(interrupted.pending, false)
    equal(
      'error' in interrupted ? interrupted.error : undefined,
      'Preparation was interrupted. Resume the saved document.',
    )
  })
}
