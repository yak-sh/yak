import { call } from './transport'

export type Project = { id: string; title: string }
export type Result = { id: string; title: string; body?: string }
export type Message = { id: string; role: 'user' | 'assistant'; text: string }
export type Conversation = {
  id: string
  status: string
  messages: Message[]
  before: boolean
  nextBefore: number | null
}
type Bundle = {
  entity: { eid: string; num?: number }
  content?: { body?: string }
  doc?: { title?: string; body?: string }
  [key: string]: unknown
}
type Caller = <T>(name: string, args: Record<string, unknown>) => Promise<T>
type Started = { session: string; project: string; status: string }

// Conversation tools answer a JSON envelope inside their ordinary tool-output
// bundle. Generic graph reads answer the bundles themselves. This adapter is
// shared by every command and is the only place that opens a conversation.
function envelope<T>(result: unknown): T {
  if (!Array.isArray(result)) {
    throw new Error('The box returned an invalid conversation response.')
  }
  const body = (result[0] as Bundle | undefined)?.content?.body
  if (typeof body !== 'string') {
    throw new Error('The box did not return a conversation response.')
  }
  return JSON.parse(body) as T
}

function results(rows: Bundle[]): Result[] {
  return rows.map((row) => ({
    id: row.entity.eid,
    title: row.doc?.title || row.content?.body?.split('\n')[0] ||
      row.entity.eid,
    body: row.doc?.body || row.content?.body,
  }))
}

export function createClient(invoke: Caller) {
  return {
    async projects(): Promise<Project[]> {
      return envelope<{ projects: Project[] }>(
        await invoke('conversation_projects', {}),
      ).projects
    },
    async drop(
      text: string,
      project: string,
    ): Promise<{ id: string; title?: string }> {
      if (!text.trim()) throw new Error('Say something first.')
      const started = envelope<Started>(
        await invoke('conversation_start', { project, prompt: text }),
      )
      if (typeof started.session !== 'string' || !started.session) {
        throw new Error(
          'The box did not acknowledge the conversation. Check recent conversations before retrying.',
        )
      }
      return { id: started.session }
    },
    async recent(
      project: string,
    ): Promise<Array<{ id: string; title: string; status?: string }>> {
      const found = envelope<{
        conversations: Array<Started & { title: string }>
      }>(await invoke('conversation_recent', { project, limit: 30 }))
      return found.conversations.map((row) => ({
        id: row.session,
        title: row.title,
        status: row.status,
      }))
    },
    async conversation(
      id: string,
      project: string,
      before?: number,
    ): Promise<Conversation> {
      const found = envelope<
        Started & {
          messages: Message[]
          before: boolean
          nextBefore: number | null
        }
      >(
        await invoke('conversation_read', {
          session: id,
          project,
          limit: 200,
          ...(before == null ? {} : { before }),
        }),
      )
      return {
        id: found.session,
        status: found.status,
        messages: found.messages,
        before: found.before,
        nextBefore: found.nextBefore,
      }
    },
    async send(id: string, text: string, project: string): Promise<void> {
      if (!text.trim()) throw new Error('Say something first.')
      envelope<Started>(
        await invoke('conversation_send', { session: id, project, text }),
      )
    },
    async search(text: string): Promise<Result[]> {
      if (!text.trim()) return []
      // Treat search as text, never let punctuation become graph directives.
      const q = `${JSON.stringify(text.trim())} ?doc .limit=50`
      return results(await invoke<Bundle[]>('graph_query', { q }))
    },
    async inbox(): Promise<Result[]> {
      return results(
        await invoke<Bundle[]>('conversation_inbox', { limit: 50 }),
      )
    },
  }
}

const client = createClient(call)
export const { projects, drop, recent, conversation, send, search, inbox } =
  client
export function resultUrl(id: string): string {
  return `https://tasks.yak.sh/${encodeURIComponent(id)}`
}
