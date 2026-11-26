// What a person gives to connect a pasted-key integration, apart from the
// integrations themselves, so a page drawing the box a key is pasted in
// (./form.ts) loads none of their seed data.

/** One thing a person gives to connect a pasted-key integration: what an app
 * reads it by, what the page asks for it by, whether it is typed in the open,
 * as a username or a region is, and what it looks like. */
export type Field = {
  name: string
  label: string
  shown?: boolean
  example?: string
}

/** The one field of an integration that declares none: its key. */
export let KEY: Field = { name: 'key', label: 'Key' }

/** What a person gives to connect a pasted-key integration, in the order the
 * page asks for it: the fields it declares, or its one key, shaped as the
 * integration says. */
export let fieldsOf = (
  i?: { fields?: Field[]; example?: string },
): Field[] =>
  i?.fields?.length
    ? i.fields
    : [i?.example ? { ...KEY, example: i.example } : KEY]
