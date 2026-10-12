/// <reference types="@cloudflare/workers-types/index.d.ts" />
// Check the shipped entrypoints and structural bindings against the runtime's
// own contracts, apart from Deno's globals and its test substitutes.
import { type WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Inference } from '@yaks/model'
import ModelExecutor, { InferenceWorkflow } from './index.ts'
import type { Env, Steps, WorkflowBinding } from './worker.ts'

let _binding: WorkflowBinding = null as unknown as Workflow<Inference>
let _steps: Steps = null as unknown as WorkflowStep
let _receipts: Env['RECEIPTS'] = null as unknown as R2Bucket
let workflow = null as unknown as InferenceWorkflow
let executor = null as unknown as ModelExecutor
let event = null as unknown as WorkflowEvent<Inference>
let step = null as unknown as WorkflowStep

let _run: Promise<string> = workflow.run(event, step)
let _submit: Promise<void> = executor.submit(event.payload)
let _fetch: Response = executor.fetch()
let _version: { executor: string; id?: string } = executor.version()
