// Public input and output schemas shared by tool catalogs and every transport.
import type { Tool } from '@yaks/graph'
import { publicToolSchema } from '@yaks/vocab/tools'

// What a tool that declares no arguments is listed as taking: nothing.
let none = () => ({ type: 'object', additionalProperties: false })

/**
 * A tool's arguments as JSON Schema: its own `inputSchema`, published (the
 * command-line `short` letters a CLI reads stay off the wire), or none for a
 * tool that takes no arguments. This is exactly what `tools/list` sends, so
 * anything else that needs a tool's argument grammar — a CLI mapping a
 * command onto it, say — reads what an MCP client reads.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { inputSchemaOf } from '@yaks/tools/schema'
 *
 * let tool = {
 *   name: 'write',
 *   description: 'Write a doc',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { title: { type: 'string', short: 't' } },
 *   },
 *   run: () => [],
 * }
 * assertEquals(inputSchemaOf(tool).properties, { title: { type: 'string' } })
 * ```
 */
export let inputSchemaOf = (
  tool: Tool,
): { type: 'object'; [key: string]: unknown } =>
  publicToolSchema(tool.inputSchema ?? none()) as {
    type: 'object'
    [key: string]: unknown
  }

type Json = { [key: string]: unknown }

/**
 * The bundle answer for a door whose rows say words of their own beside their
 * components: {@link answerSchema}, with each of those words declared on the
 * row under its own schema. A client checks every answer against the schema
 * its tool is listed with, so a row word left undeclared reads to it as a
 * component that is not an object, and the whole answer is refused. yaks.app's
 * rows name what each entity is (`kind`), for one.
 */
export let answerWith = (
  words: Record<string, Json>,
): { type: 'object'; [key: string]: unknown } => ({
  type: 'object',
  properties: {
    result: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: {
            type: 'object',
            properties: { eid: { type: 'string' } },
            required: ['eid'],
          },
          ...words,
        },
        required: ['entity'],
        // The `$` sugars a bundle may wear beside its components — `$alias`,
        // the name a minted entity was asked for by, and the rest of
        // @yaks/graph's — are not components and are not objects, so they are
        // matched first and left open.
        patternProperties: { '^\\$': {} },
        additionalProperties: { type: ['object', 'null'] },
      },
    },
  },
  required: ['result'],
})

/**
 * The default output schema: returned bundles under `result`, shared by tool
 * discovery and transports that send structured answers.
 *
 * Every tool whose answer is entities answers this one shape, so it is written
 * once and listed on all of them, a plugin's tool included without declaring
 * anything; a tool whose answer is not entities declares its own
 * `outputSchema` (`graph_schema`, a vocabulary document). It says what a
 * bundle is and not what any component holds: a fully typed bundle is tens of
 * kilobytes of vocabulary, and `tools/list` would carry a copy per tool before
 * the agent has asked its first question. What a component holds is
 * `graph_schema`'s answer, asked for when it is wanted. It carries no prose
 * for the same reason: it rides on every tool, and `graph_apply`'s
 * description says what a bundle is once. A door whose rows carry words of
 * their own lists {@link answerWith} instead.
 */
export let answerSchema: { type: 'object'; [key: string]: unknown } =
  answerWith({})

let saids = new WeakMap<object, Json>()

/**
 * A tool's output schema as a door lists it when its structured answer also
 * carries `said`: the words its text says beside the data (@yaks/tools/result
 * `aside`) and any news the door adds, for a client that gives a model the
 * structured answer alone. A schema whose answer is not an object has nowhere
 * to say it, and is listed as declared. The same schema is answered with the
 * same object, so a check compiled from it is compiled once.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let listed = saying(answerSchema)
 * assertEquals((listed.properties as Record<string, unknown>).said, { type: 'string' })
 * assertEquals(saying(answerSchema), listed)
 * ```
 */
export let saying = (
  schema: Json,
): Json => {
  if (schema.type != null && schema.type != 'object') return schema
  let held = saids.get(schema)
  if (!held) {
    held = {
      ...schema,
      type: 'object',
      properties: {
        ...(schema.properties as Json | undefined),
        said: { type: 'string' },
      },
    }
    saids.set(schema, held)
  }
  return held
}
