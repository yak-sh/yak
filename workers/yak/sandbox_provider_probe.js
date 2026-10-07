// Test-only container RPCs in workerd, without an image or a live container.
import { DurableObject } from 'cloudflare:workers'
import { exercise } from './sandbox_provider_fixture.ts'

export class ContainerProbe extends DurableObject {
  async setSleepAfter(after) {
    await this.ctx.storage.put('sleep', after)
  }
  exec(_command, _opts) {
    return { stdout: 'pkg/app.wasm\n', stderr: '', exitCode: 0 }
  }
  async startProcess(command, opts) {
    if (
      opts.cwd != '/workspace' || opts.timeout != 240_000 ||
      opts.autoCleanup !== false
    ) {
      throw new Error('process options changed')
    }
    if (
      command == 'compile-provider'
        ? opts.env.PROBE != 'invocation'
        : !opts.env.YAKS_TOKEN
    ) {
      throw new Error('invocation environment missing')
    }
    await this.ctx.storage.put('process', { command, opts, status: 'running' })
    return { id: 'p', pid: 42 }
  }
  async getProcess() {
    let p = await this.ctx.storage.get('process')
    return p
      ? {
        pid: 42,
        status: p.status,
        exitCode: p.status == 'running' ? undefined : 0,
      }
      : null
  }
  getProcessLogs() {
    return { stdout: 'one\ntwo\n', stderr: 'warning\n' }
  }
  async killProcess() {
    let p = await this.ctx.storage.get('process')
    await this.ctx.storage.put('process', { ...p, status: 'killed' })
  }
  mkdir() {}
  async writeFile(path, content, opts) {
    let base64 = opts?.encoding == 'base64'
      ? content
      : btoa(String.fromCharCode(...new TextEncoder().encode(content)))
    await this.ctx.storage.put(path, base64)
  }
  async readFile(path, opts) {
    let content = await this.ctx.storage.get(path)
    if (content == null) throw new Error('no file ' + path)
    return {
      content: opts?.encoding == 'base64' ? content : new TextDecoder().decode(
        Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
      ),
    }
  }
  async destroy() {
    await this.ctx.storage.deleteAll()
  }
}

export default {
  async fetch(_req, env) {
    try {
      return Response.json(await exercise(env.SANDBOX))
    } catch (e) {
      return new Response(e.stack, { status: 500 })
    }
  },
}
