import { getAccessToken, RESOURCE } from './auth'

export type MCPClientOptions = {
  endpoint?: string
  request?: typeof fetch
  timeoutMs?: number
}
type RPC = {
  jsonrpc?: string
  id?: number
  result?: unknown
  error?: { code: number; message: string }
}
const PROTOCOL = '2025-06-18'

function safeMessage(value: unknown): string {
  return String(value)
    .replace(
      /Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi,
      '[redacted]',
    )
    .replace(
      /(?:access_token|refresh_token|client_secret)["'\s:=]+[^\s,}"']+/gi,
      '[redacted]',
    )
    .slice(0, 500)
}

/** Streamable HTTP MCP. An injected request must supply its own authentication. Calls are never replayed. */
export class MCPClient {
  private readonly endpoint: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number
  private readonly authenticated: boolean
  private session?: string
  private protocol = PROTOCOL
  private initialized?: Promise<void>
  private nextId = 0

  constructor(options: MCPClientOptions = {}) {
    this.endpoint = options.endpoint ?? RESOURCE
    this.request = options.request ?? fetch
    this.authenticated = !options.request
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  private async rpc(
    method: string,
    params?: unknown,
    notification = false,
  ): Promise<unknown> {
    const id = notification ? undefined : ++this.nextId
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      // Suppress the legacy MCP connection transcript. This is a client label,
      // never an actor id: authentication still belongs to the host door.
      'X-Via': 'yak-raycast',
    })
    if (method !== 'initialize') {
      headers.set('MCP-Protocol-Version', this.protocol)
    }
    if (this.session) headers.set('Mcp-Session-Id', this.session)
    if (this.authenticated) {
      headers.set('Authorization', `Bearer ${await getAccessToken()}`)
    }
    let response: Response
    try {
      response = await this.request(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(notification ? {} : { id }),
          method,
          ...(params === undefined ? {} : { params }),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new Error(
        `MCP ${method} could not reach Yak or timed out. Its outcome may be unknown; check before retrying.`,
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Yak authentication was rejected (${response.status}). Sign out of Yak in Raycast preferences and sign in again. The call was not retried.`,
        )
      }
      if (response.status === 404 && this.session) {
        this.initialized = undefined
        this.session = undefined
      }
      throw new Error(
        `MCP ${method} failed (HTTP ${response.status}). The call was not retried.`,
      )
    }
    const session = response.headers.get('Mcp-Session-Id')
    if (session) this.session = session
    if (notification) {
      await response.body?.cancel()
      return
    }
    let message: RPC
    try {
      message = response.headers
          .get('Content-Type')
          ?.includes('text/event-stream')
        ? await this.sse(response, id!)
        : ((await response.json()) as RPC)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('MCP stream')) {
        throw error
      }
      throw new Error(
        `MCP ${method} returned an invalid or incomplete response. The call was not retried.`,
      )
    }
    if (!message || message.jsonrpc !== '2.0' || message.id !== id) {
      throw new Error(`MCP ${method} returned a mismatched response.`)
    }
    if (message.error) {
      throw new Error(
        `MCP ${method}: ${
          safeMessage(
            message.error.message,
          )
        } (${message.error.code})`,
      )
    }
    if (!('result' in message)) {
      throw new Error(`MCP ${method} returned no result.`)
    }
    return message.result
  }

  private async sse(response: Response, id: number): Promise<RPC> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('MCP stream returned no body.')
    const decoder = new TextDecoder()
    let buffer = ''
    let data: string[] = []
    function event(): RPC | undefined {
      if (!data.length) return
      const text = data.join('\n')
      data = []
      const value = JSON.parse(text) as RPC
      return value.id === id ? value : undefined
    }
    try {
      for (;;) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        if (buffer.length > 8 * 1024 * 1024) {
          throw new Error('MCP stream exceeded the response limit.')
        }
        let newline: RegExpExecArray | null
        // CRLF may be split across chunks, so hold a trailing CR until the next read.
        while ((newline = /\r\n|\n|\r(?!$)/.exec(buffer))) {
          const line = buffer.slice(0, newline.index)
          buffer = buffer.slice(newline.index + newline[0].length)
          if (!line) {
            const found = event()
            if (found) return found
          } else if (line === 'data') data.push('')
          else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''))
          }
        }
        if (done) {
          if (buffer.startsWith('data:')) {
            data.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''))
          }
          const found = event()
          if (found) return found
          throw new Error(
            'MCP stream ended before the call returned. Check its outcome before retrying.',
          )
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const result = (await this.rpc('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'yak-raycast', version: '1.0.0' },
      })) as { protocolVersion?: string }
      if (![PROTOCOL, '2025-03-26'].includes(result?.protocolVersion ?? '')) {
        throw new Error('Yak negotiated an unsupported MCP protocol version.')
      }
      this.protocol = result.protocolVersion!
      await this.rpc('notifications/initialized', undefined, true)
    })().catch((error) => {
      this.initialized = undefined
      throw error
    })
    return this.initialized
  }

  /** Decodes the tool's structured value (unwrapping Yak's {result: ...}), or JSON/text content. */
  async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.initialize()
    const result = (await this.rpc('tools/call', {
      name,
      arguments: args,
    })) as {
      content?: { type: string; text?: string }[]
      structuredContent?: unknown
      isError?: boolean
    }
    if (!result || typeof result !== 'object') {
      throw new Error(`Yak tool ${name} returned no content.`)
    }
    const text = result.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('\n')
    if (result.isError) {
      throw new Error(
        `Yak tool ${name}: ${safeMessage(text || 'Call refused')}`,
      )
    }
    if (result.structuredContent !== undefined) {
      const value = result.structuredContent
      return (
        value && typeof value === 'object' && 'result' in value
          ? value.result
          : value
      ) as T
    }
    if (text === undefined) {
      throw new Error(`Yak tool ${name} returned no readable content.`)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }
}

const client = new MCPClient()
export function call<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return client.call<T>(name, args)
}
