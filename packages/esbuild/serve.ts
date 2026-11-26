import compiler from './compile.ts'

// Cloudflare sends SIGTERM before replacing the container. Finish the jobs
// already accepted so a rollout need not make their callers build twice.
let server = Deno.serve({ port: 8080 }, compiler.fetch)
let stop = () => void server.shutdown()
Deno.addSignalListener('SIGTERM', stop)
await server.finished
Deno.removeSignalListener('SIGTERM', stop)
