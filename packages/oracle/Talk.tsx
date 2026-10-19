/** @jsxImportSource preact */
// Asking an oracle records a tool call with the shared durable composer.
// The native dialogue appears in the page's live conversation list.
import type { Bundle, Props } from '@yaks/inspect'
import { identityEid } from '@yaks/graph/identity'
import { Composer } from '@yaks/kernel/Comments'
import { Section } from '@yaks/ui'

export let question = (oracle: string, text: string): Bundle[] => [{
  entity: { eid: crypto.randomUUID() },
  call: {
    to: identityEid('tool', ['oracle_query']),
    source: oracle,
    args: { oracle, text },
  },
}]

export let Talk = ({ e, io }: Props) => {
  if (!io.edits) return null
  let got = io.ask({
    provider: '.provider.name=openai ?using',
    failures:
      `(.refusal|.exception) .output.source.call.source=${e.entity.eid} ?content .order=-created.at .limit=3`,
  })
  let provider = got.provider.rows[0]?.using
  let model = provider && typeof provider == 'object' && 'model' in provider
    ? String(provider.model)
    : ''
  let names = io.ask(model ? { model: `.entity.eid=${model} ?model ?doc` } : {})
  let m = names.model?.rows[0]?.model
  let name = m && typeof m == 'object' && 'name' in m ? String(m.name) : ''
  let target = e.topic ? 'about this topic' : 'this oracle'
  return (
    <Section data-section='ask-oracle'>
      <Section.Title>Ask {target}</Section.Title>
      <Section.Sub>
        Starts a separate native conversation{name ? ` with ${name}` : ''}. Open
        it below to read and continue; its session page can change models.
      </Section.Sub>
      <Composer
        eid={e.entity.eid}
        entry
        make={(text) => question(e.entity.eid, text)}
        placeholder={`Ask ${target}…`}
        submit='Start conversation'
      />
      {got.failures.rows.map((row) => {
        let content = row.content
        return (
          <Section.Note key={row.entity.eid} mod='refused'>
            {content && typeof content == 'object' && 'body' in content
              ? String(content.body)
              : 'The conversation could not start.'}
          </Section.Note>
        )
      })}
    </Section>
  )
}
