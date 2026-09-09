// The split owner reads the same SQLite file as the server, but has its own
// module state. Exercise their shared boot seam with a separate connection and
// a fake embed transport: no running daemon, provider, or credential store.
import { assertEquals } from '@std/assert'
import { apply, settingValue } from './db.ts'
import {
  configureEmbed,
  embedSweep,
  MODEL,
  setEmbedConfig,
  setModel,
  stale,
} from './embed.ts'
import { resolve } from './config.ts'
import { envConfig } from './ollama.ts'
import { open } from './store/sqlite.ts'
import { slow } from './testing.ts'
import { DIM, initVector, ownVector, vectorReady } from './vector.ts'

slow(
  'split embed config: overrides before sweep; restart preserves the corpus',
  async () => {
    let dir = Deno.makeTempDirSync()
    let path = `${dir}/graph.db`
    let writer = open(path)
    writer.exec('delete from doc')
    let base = crypto.randomUUID()
    let model = crypto.randomUUID()
    let docs = [crypto.randomUUID(), crypto.randomUUID()]
    let save = (eid: string, key: string, value: string) =>
      apply(writer, [{ eid, name: 'setting', comp: { key, value } }])
    save(base, 'OLLAMA_BASE_URL', 'https://embed.example/v1')
    save(model, 'OLLAMA_EMBED_MODEL', 'explicit-model')
    for (let [i, eid] of docs.entries()) {
      apply(writer, [{ eid, name: 'doc', comp: { title: `doc ${i}` } }])
    }
    ownVector()
    let daemon = open(path, true)
    let oldModel = MODEL
    let oldFetch = globalThis.fetch
    let env = ['TASKS_EMBED', 'OLLAMA_BASE_URL', 'OLLAMA_EMBED_MODEL']
    let before = env.map((key) => Deno.env.get(key))
    let calls: { url: string; model: string }[] = []
    let rows = () =>
      writer.prepare(
        'select entity, model, hash, vec, at from embedding order by entity',
      )
        .all()
    // This is the exact seam called by server_runtime and effectsd. The config
    // closes over the daemon's connection, not the writer's or a settings cache.
    let boot = () => {
      setModel(resolve('OLLAMA_EMBED_MODEL', () => undefined).value!)
      configureEmbed({
        base: () =>
          resolve('OLLAMA_BASE_URL', (key) => settingValue(daemon, key)).value!,
        key: () => Promise.resolve(undefined),
      }, (key) => settingValue(daemon, key))
      initVector(daemon)
    }
    try {
      Deno.env.set('TASKS_EMBED', '1')
      Deno.env.set('OLLAMA_BASE_URL', 'https://env.example')
      Deno.env.set('OLLAMA_EMBED_MODEL', 'env-model')
      globalThis.fetch = (url, init) => {
        calls.push({
          url: String(url),
          model: JSON.parse(String(init?.body)).model,
        })
        return Promise.resolve(
          Response.json({ embeddings: [Array(DIM).fill(1)] }),
        )
      }
      assertEquals(vectorReady(daemon), true)
      boot()
      assertEquals(MODEL, 'explicit-model', 'graph override beats environment')
      assertEquals(await embedSweep(daemon), 2)
      assertEquals(
        calls,
        docs.map(() => ({
          url: 'https://embed.example/api/embed',
          model: 'explicit-model',
        })),
      )
      let fresh = rows()

      // A new connection and freshly initialized module model emulate a daemon
      // restart. Boot must neither erase vectors nor make unchanged docs stale.
      daemon.close()
      daemon = open(path, true)
      boot()
      calls.length = 0
      assertEquals(stale(daemon), [])
      assertEquals(await embedSweep(daemon), 0)
      assertEquals(calls, [])
      assertEquals(rows(), fresh)

      // URL edits are live, but not a model-space change: only edited prose owes.
      save(base, 'OLLAMA_BASE_URL', 'https://changed.example/')
      assertEquals(await embedSweep(daemon), 0)
      apply(writer, [{ eid: docs[0], name: 'doc', comp: { title: 'edited' } }])
      assertEquals(await embedSweep(daemon), 1)
      assertEquals(calls, [{
        url: 'https://changed.example/api/embed',
        model: 'explicit-model',
      }])

      // A saved model is deliberate and takes effect at the next boot, in both
      // owners. Unlike an ordinary restart it makes the whole corpus stale.
      save(model, 'OLLAMA_EMBED_MODEL', 'next-model')
      assertEquals(
        await embedSweep(daemon),
        0,
        'model is fixed during a process',
      )
      boot()
      calls.length = 0
      assertEquals(stale(daemon).length, 2)
      assertEquals(await embedSweep(daemon), 2)
      assertEquals(calls.map((c) => c.model), ['next-model', 'next-model'])
      boot()
      assertEquals(
        await embedSweep(daemon),
        0,
        'model change re-embeds only once',
      )

      // Removing the graph override returns to the same env/default precedence
      // as the server, without any special daemon fallback.
      apply(writer, [{ eid: model, name: 'setting', comp: null }])
      boot()
      assertEquals(MODEL, 'env-model')
      Deno.env.delete('OLLAMA_EMBED_MODEL')
      boot()
      assertEquals(MODEL, resolve('OLLAMA_EMBED_MODEL', () => undefined).value)
    } finally {
      globalThis.fetch = oldFetch
      setModel(oldModel)
      setEmbedConfig(envConfig)
      for (let [i, key] of env.entries()) {
        if (before[i] === undefined) Deno.env.delete(key)
        else Deno.env.set(key, before[i]!)
      }
      daemon.close()
      writer.close()
      Deno.removeSync(dir, { recursive: true })
    }
  },
)
