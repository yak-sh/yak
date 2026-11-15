// A local MCP client over stdio. File references expand here, before an HTTP
// request leaves the process that owns the files.
import { CallError } from '@yaks/tools/errors'
import { fileArgs, FILES, fileSchema, type ReadFile } from './files.ts'
import { Refused, type Rpc } from './rpc.ts'

type Object = Record<string, unknown>
type Tool = { name: string; inputSchema: Object }
type Request = { id?: string | number | null; method: string; params?: Object }

/** One local client's requests, with its own tool schemas and file reader. */
export let bridge = (
  ask: Rpc,
  read: ReadFile,
): (request: Request) => Promise<Object | undefined> => {
  let schemas = new Map<string, Object>()
  let list = async (params?: Object): Promise<Object> => {
    let out = await ask('tools/list', params)
    return {
      ...out,
      tools: (out.tools as Tool[]).map((tool) => {
        schemas.set(tool.name, tool.inputSchema)
        return { ...tool, inputSchema: fileSchema(tool.inputSchema) }
      }),
    }
  }
  let call = async (params: Object) => {
    let name = params.name as string
    if (!schemas.has(name)) await list()
    return await ask('tools/call', {
      ...params,
      arguments: await fileArgs(
        (params.arguments ?? {}) as Object,
        schemas.get(name) ?? {},
        read,
      ),
    })
  }
  return async ({ id, method, params }) => {
    if (id === undefined) return
    try {
      let result = method == 'tools/list'
        ? await list(params)
        : method == 'tools/call'
        ? await call(params ?? {})
        : await ask(method, params)
      if (method == 'initialize') {
        result = {
          ...result,
          instructions: [result.instructions, FILES].filter(Boolean).join(
            '\n\n',
          ),
        }
      }
      return { jsonrpc: '2.0', id, result }
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      return error instanceof CallError && method == 'tools/call'
        ? {
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: message }] },
        }
        : {
          jsonrpc: '2.0',
          id,
          error: {
            code: error instanceof Refused ? error.code ?? -32603 : -32603,
            message,
          },
        }
    }
  }
}

/** Newline-delimited JSON-RPC, with independent requests answered as they end. */
export let stdio = async (
  input: AsyncIterable<string>,
  write: (line: string) => void,
  answer: ReturnType<typeof bridge>,
): Promise<void> => {
  let pending = new Set<Promise<void>>()
  for await (let line of input) {
    let request: Request
    try {
      request = JSON.parse(line)
    } catch {
      write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Invalid JSON' },
      }))
      continue
    }
    if (
      !request || typeof request != 'object' ||
      typeof request.method != 'string'
    ) {
      write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request' },
      }))
      continue
    }
    let work = answer(request).then((reply) => {
      if (reply) write(JSON.stringify(reply))
    })
    pending.add(work)
    void work.finally(() => pending.delete(work))
  }
  await Promise.all(pending)
}
