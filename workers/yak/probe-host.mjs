// One bundle and one kernel workerd per suite, shared by all default AND
// var-configured leases. probe-entry.mjs gives leases distinct physical DO,
// KV and R2 names. Only script() needs other code: its two generated app
// module probes use short-lived runtimes rather than reloading the kernel.
import { createRequire } from 'node:module'
import { createServer, request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Disposable SQLite still uses real workerd storage, but needs no disk
// durability between runs. Prefer RAM-backed temporary files on Linux when
// there is room; respect TMPDIR and fall back to the ordinary temp directory.
let temp = tmpdir()
if (!process.env.TMPDIR && process.platform === 'linux') {
  try {
    const { bavail, bsize } = statfsSync('/dev/shm')
    if (bavail * bsize >= 512 * 1024 * 1024) temp = '/dev/shm'
  } catch { /* /dev/shm is not available on every runner. */ }
}
const scratch = mkdtempSync(join(temp, 'yak-probes-'))
// Miniflare's signal hook exits synchronously, before an async handler can
// finish. Its hook reaps workerd; ours removes the enclosing scratch tree.
process.once('exit', () => rmSync(scratch, { recursive: true, force: true }))
// Miniflare's own temp directories must be inside our lifetime too: dispose()
// schedules their deletion without awaiting it, and process.exit can win.
process.env.TMPDIR = scratch
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'
process.env.WRANGLER_SEND_METRICS = 'false'
const require = createRequire(import.meta.url)
const { unstable_readConfig, unstable_getMiniflareWorkerOptions } = require(
  'wrangler',
)
const { Miniflare, Log, LogLevel } = require('miniflare')
const root = fileURLToPath(new URL('./', import.meta.url))
const leases = new Map()
let runtime

class ProbeLog extends Log {
  constructor(path) {
    super(LogLevel.INFO)
    this.path = path
  }
  log(message) {
    appendFileSync(this.path, message + '\n')
  }
}

try {
  execFileSync(process.execPath, [
    join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'deploy',
    join(root, 'probe-entry.mjs'),
    '--dry-run',
    '--minify',
    '--containers-rollout=none',
    '--outdir',
    scratch,
  ], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
  const modules = [{
    type: 'ESModule',
    path: join(scratch, 'probe-entry.js'),
    contents: readFileSync(join(scratch, 'probe-entry.js'), 'utf8'),
  }]
  const config = unstable_readConfig({ config: join(root, 'wrangler.toml') })
  config.assets.directory = resolve(root, config.assets.directory)
  // The normalized paths are already absolute. Move only secret discovery to
  // our empty directory, never the developer's .dev.vars or .env.
  config.configPath = join(scratch, 'wrangler.toml')
  config.dev.enable_containers = false
  const { workerOptions } = unstable_getMiniflareWorkerOptions(
    config,
    undefined,
    {
      overrides: { enableContainers: false },
    },
  )
  // Same absent bindings as wrangler dev --local --enable-containers=false.
  for (
    const name of [
      'ai',
      'vectorize',
      'dispatchNamespaces',
      'tails',
      'serviceBindings',
    ]
  ) {
    delete workerOptions[name]
  }
  delete workerOptions.durableObjects.SANDBOX

  runtime = new Miniflare({
    ...workerOptions,
    name: 'yak',
    modules,
    modulesRoot: scratch,
    host: '127.0.0.1',
    port: 0,
    cf: false,
    unsafeTriggerHandlers: true,
    unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }],
    log: new Log(LogLevel.ERROR),
    handleRuntimeStdio: (stdout, stderr) => {
      for (const stream of [stdout, stderr]) {
        let pending = ''
        stream.on('data', (chunk) => {
          pending += chunk
          let end
          while ((end = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, end)
            pending = pending.slice(end + 1)
            const match = /\[probe:([^\]]+)\] (.*)/.exec(line)
            const lease = match && leases.get(match[1])
            if (lease) appendFileSync(lease.log, match[2] + '\n')
            else console.error(line)
          }
        })
      }
    },
  })
  const direct = await runtime.unsafeGetDirectURL()
  const entry = await runtime.ready

  const server = createServer(async (req, res) => {
    try {
      // Wrangler normally supplies the HTTP proxy. Keep that boundary here:
      // workerd may reject an oversized upload before reading its body. A
      // direct Deno→workerd socket resets before Deno can read that 413 body.
      const route = /^\/fetch\/([^/]+)(\/.*)$/.exec(req.url)
      if (route) {
        const lease = leases.get(route[1])
        if (!lease) return res.writeHead(404).end()
        const target = new URL(
          route[2],
          route[2].startsWith('/cdn-cgi/') ? entry : direct,
        )
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        let body = Buffer.concat(chunks)
        if (route[2].startsWith('/cdn-cgi/handler/email')) {
          body = Buffer.concat([
            Buffer.from(`x-yak-probe: ${lease.scope}\r\n`),
            body,
          ])
        }
        const headers = { ...req.headers }
        delete headers['transfer-encoding']
        const upstream = httpRequest(target, {
          method: req.method,
          // probe-entry drains the upload before invoking the kernel, so an
          // early application rejection leaves a reusable HTTP connection.
          headers: {
            ...headers,
            host: target.host,
            'content-length': body.length,
            'x-yak-probe': lease.scope,
          },
        }, (response) => {
          res.writeHead(response.statusCode, response.headers)
          response.on('error', () => res.destroy())
          response.pipe(res)
          res.on('close', () => response.destroy())
        })
        upstream.on('error', (error) => {
          if (!res.headersSent) res.writeHead(502).end(String(error))
        })
        upstream.end(body)
        return
      }
      const id = req.url.slice(1)
      if (req.method === 'DELETE') {
        const lease = leases.get(id)
        if (lease) {
          await lease.mf?.dispose()
          leases.delete(id)
          rmSync(lease.dir, { recursive: true, force: true })
        }
        res.end('{}')
        return
      }
      if (req.method !== 'POST' || req.url !== '/') {
        res.writeHead(404).end()
        return
      }
      let body = ''
      for await (const chunk of req) body += chunk
      const { vars = {}, files, main = 'entry.js' } = JSON.parse(body)
      const key = randomUUID()
      const dir = mkdtempSync(join(scratch, 'lease-'))
      const log = join(dir, 'worker.log')
      writeFileSync(log, '')
      const secret = randomUUID()
      const scope = JSON.stringify({ id: key, secret, vars })
      const mf = files
        ? new Miniflare({
          modules: Object.entries(files).map(([name, contents]) => ({
            type: name.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule',
            path: join(dir, name),
            contents: typeof contents === 'string'
              ? contents
              : Buffer.from(contents),
          })).sort((a, b) =>
            Number(b.path === join(dir, main)) -
            Number(a.path === join(dir, main))
          ),
          compatibilityDate: '2025-05-08',
          modulesRoot: dir,
          host: '127.0.0.1',
          port: 0,
          cf: false,
          log: new ProbeLog(log),
        })
        : undefined
      leases.set(key, { mf, dir, log, scope })
      try {
        const base = mf
          ? (await mf.ready).origin
          : `http://127.0.0.1:${server.address().port}/fetch/${key}`
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            id: key,
            base,
            secret,
            log,
            socket: {
              port: Number(direct.port),
              headers: { 'x-yak-probe': scope },
            },
          }),
        )
      } catch (error) {
        await mf?.dispose()
        leases.delete(key)
        rmSync(dir, { recursive: true, force: true })
        throw error
      }
    } catch (error) {
      res.writeHead(500).end(String(error.stack ?? error))
    }
  })
  server.listen(0, '127.0.0.1', () => {
    console.log(`Ready on http://127.0.0.1:${server.address().port}`)
  })
  // The Deno runner owns stdin. EOF also cleans up after a killed test runner.
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    server.close()
    await Promise.allSettled(
      [...leases.values()].map(({ mf }) => mf?.dispose()),
    )
    await runtime.dispose()
    rmSync(scratch, { recursive: true, force: true })
    process.exit(0)
  }
  process.stdin.resume()
  process.stdin.on('end', close)
} catch (error) {
  await runtime?.dispose()
  rmSync(scratch, { recursive: true, force: true })
  throw error
}
