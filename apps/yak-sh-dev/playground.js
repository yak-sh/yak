// A real in-memory graph and yak's CLI parser. Commands call the graph directly;
// this is a deliberately small book vocabulary, not the hosted app's store.
import { graph, offered } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { cli, helpTool } from '@yaks/cli'
import { tier } from '@yaks/graph/tools'
import {
  answerOf,
  faulted,
  runner,
  structured,
  toolEid,
  toolsDoc,
} from '@yaks/tools'

// Preserve quoted JSON as one argument, including empty quoted values.
export function words(line) {
  const result = []
  let word = '', quote = '', started = false
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) result.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote) throw new Error('Close the quoted argument before running it.')
  if (started) result.push(word)
  return result
}

export async function create() {
  const vocab = loadVocab([toolsDoc, {
    $defs: {
      book: {
        type: 'object',
        component: true,
        properties: { title: { type: 'string' }, pages: { type: 'number' } },
      },
    },
  }])
  const g = graph({ vocab, storage: ram(vocab) })
  await g.install()
  await g.apply([{
    entity: { eid: 'book:dune' },
    book: { title: 'Dune', pages: 412 },
  }])
  const tools = tier().filter(offered('cli'))
  const calls = runner(g, { tools })
  await calls.ensure()
  const commands = [
    ...tools.map((tool) => ({
      ...tool,
      run: async (args, context) => {
        const landed = await calls.call({
          entity: { eid: '$call' },
          call: { to: toolEid(tool.name), args: args ?? {} },
        })
        let value = structured(tool, answerOf(landed))
        // Older releases wrap query JSON in the result’s content body.
        const body = value.result?.[0]?.content?.body
        if (body) {
          try {
            value = { result: JSON.parse(body) }
          } catch { /* Keep non-JSON tool text. */ }
        }
        context.out(JSON.stringify(value, null, 2))
        return faulted(landed) ? 1 : 0
      },
    })),
    helpTool({
      name: 'yak',
      about:
        'An in-memory book graph. Commands: graph query <q>, graph apply --bundles <JSON>.',
    }),
  ]
  return {
    books: () => g.read('.book'),
    run: (line, out) =>
      cli(commands, {
        argv: words(line),
        name: 'yak',
        about: 'An in-memory book graph.',
        host: 'this tab',
        env: (name) => name === 'YAKS_HOME' ? '/nowhere' : undefined,
        ask: () => {
          throw new Error('This playground does not call a server.')
        },
        reads: {
          file: () => {
            throw new Error('This playground has no filesystem.')
          },
          stdin: () => '',
        },
        out,
        note: out,
      }),
  }
}
