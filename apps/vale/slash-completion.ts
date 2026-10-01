// Chat's domain adapter: the shared command grammar owns flags and values;
// the host owns entity lookup and the completion UI owns taking a replacement.
import {
  complete,
  type Grammar,
  type Lookup,
  tokensIn,
} from '@yaks/cli/grammar'
import { grammars as commandGrammars, type Tools } from './slash.ts'

export type SlashCompletion = {
  from: number
  to: number
  cands: { text: string; kind: string }[]
  whole: boolean
}

/** Complete the same available tool listing that slash() executes. */
export function slashComplete(
  tools: Tools,
  text: string,
  caret: number,
  lookup: Lookup,
): Promise<SlashCompletion> {
  return slashCompletion(commandGrammars(tools), text, caret, lookup)
}

/** Complete only a slash at the start of chat, using the caller's commands.
 * Ranges cover the word before the caret, including any quotes or --name=,
 * but never the leading slash. Text after the caret is left to the host. */
export async function slashCompletion(
  grammars: readonly Grammar[],
  line: string,
  caret: number,
  lookup: Lookup,
): Promise<SlashCompletion> {
  let at = Math.max(0, Math.min(line.length, caret))
  if (!line.startsWith('/') || at < 1) {
    return { from: at, to: at, cands: [], whole: false }
  }
  let prefix = line.slice(1, at)
  let words = tokensIn(prefix, true)
  let word = words.at(-1)!
  // Help is an adapter command, but its argument still uses the shared
  // grammar's enum completion rather than a second argument parser.
  let tools: readonly Grammar[] = [
    ...grammars.filter((g) => g.name != 'help'),
    {
      name: 'help',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: grammars.flatMap((g) =>
              g.name && g.name != 'help' ? [g.name] : []
            ),
          },
        },
        additionalProperties: false,
      },
      options: { positional: ['command'] },
    },
  ]
  let offered = await complete(tools, prefix, lookup)
  let typed = prefix.slice(word.from, word.to)
  let kind = words.length == 1 ? 'command' : 'value'
  return {
    from: word.from + 1,
    to: word.to + 1,
    cands: offered.filter((text) => text != typed).map((text) => ({
      text,
      kind: text.startsWith('--') && !text.includes('=') ? 'flag' : kind,
    })),
    whole: offered.includes(typed),
  }
}
