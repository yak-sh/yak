/// <reference types="@cloudflare/workers-types/index.d.ts" />
import tail, { type Env } from './tail.ts'

let _handler: ExportedHandler<Env> = tail
let _kv: Env['SEEN'] = null as unknown as KVNamespace
let _mail: Env['MAIL'] = null as unknown as SendEmail
