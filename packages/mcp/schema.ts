// The API contract applies to the final transport schema, including arguments
// the door adds. Nested JSON Schema combinators and property names stay intact.
// https://code.claude.com/docs/en/mcp#tools-with-invalid-input-schemas
export let inputSchema = <S extends Record<string, unknown>>(
  name: string,
  schema: S,
): S => {
  let fail = (why: string): never => {
    throw new Error(`${name}: invalid MCP input schema: ${why}`)
  }
  if (schema.type != 'object') fail('root type must be object')
  for (let key of ['anyOf', 'oneOf', 'allOf']) {
    if (key in schema) fail(`${key} is unsupported at the root`)
  }
  for (let key of Object.keys(schema.properties ?? {})) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
      fail(`property ${JSON.stringify(key)} must match [a-zA-Z0-9_.-]{1,64}`)
    }
  }
  return schema
}
