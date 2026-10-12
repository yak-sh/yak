// Cloudflare inheritance is confined to these two runtime entrypoints.
import { WorkerEntrypoint, WorkflowEntrypoint } from 'cloudflare:workers'
import type { Inference } from '@yaks/model'
import { ModelError } from '@yaks/model'
import { type Env, RELEASE, run, type Steps, submit } from './worker.ts'

export class InferenceWorkflow extends WorkflowEntrypoint<Env, Inference> {
  override run(event: { payload: Inference; instanceId: string }, step: Steps) {
    if (event.instanceId !== event.payload.call) {
      throw new ModelError('inference_identity')
    }
    return run(this.env, event.payload, step)
  }
}

export default class ModelExecutor extends WorkerEntrypoint<Env> {
  submit(job: Inference) {
    return submit(this.env, job)
  }
  version() {
    return { executor: RELEASE, ...this.env.VERSION_METADATA }
  }
  override fetch() {
    return new Response('Not found', { status: 404 })
  }
}
