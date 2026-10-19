// Configuration restores the host's secrets and sign-ins using their existing
// graph and authorization doors. Credential input stays private and is never
// prefilled; each entity's public face is drawn by the shared renderer.
import { signal } from '@preact/signals'
import { useEffect, useMemo } from 'preact/hooks'
import { Button, Field, Rows, Section } from '@yaks/ui'
import { saveSecret, signIn } from '../configuration.ts'
import { type Ent, vocab } from '../types.ts'
import { Entity } from './Entity.tsx'
import { usePage } from './page.ts'
import { useQuery } from './useQuery.ts'

let useProgress = (place: string) => {
  let page = usePage<{ busy: boolean; message: string }>('Configuration', place)
  return {
    busy: !!page.value?.busy,
    message: page.value?.message,
    run: async (work: () => Promise<string>) => {
      page.set({ busy: true, message: '' })
      try {
        page.set({ message: await work() })
      } catch (error) {
        page.set({ message: error instanceof Error ? error.message : 'Failed' })
      } finally {
        page.set({ busy: false })
      }
    },
  }
}

let Secret = ({ e }: { e?: Ent }) => {
  let input = useMemo(() => signal({ name: '', value: '' }), [])
  let progress = useProgress(e?.eid ?? 'new-secret')
  let secret = e?.secret as { name?: string } | undefined
  let name = secret?.name ?? input.value.name
  let save = () => {
    let value = input.value.value
    void progress.run(async () => {
      await saveSecret(name.trim(), value, e?.eid)
      input.value = { ...input.value, value: '' }
      return 'Saved.'
    })
  }
  return (
    <Rows.Item>
      {e ? <Entity eid={e.eid} view='Tile' /> : (
        <Field
          aria-label='New secret name'
          placeholder='Secret name'
          value={input.value.name}
          onInput={(ev: InputEvent) => {
            input.value = {
              ...input.value,
              name: (ev.currentTarget as HTMLInputElement).value,
            }
          }}
        />
      )}
      <Field
        type='password'
        aria-label={`${name || 'New secret'} value`}
        autocomplete='new-password'
        placeholder='New value or op:// reference'
        value={input.value.value}
        disabled={progress.busy}
        onInput={(ev: InputEvent) => {
          input.value = {
            ...input.value,
            value: (ev.currentTarget as HTMLInputElement).value,
          }
        }}
      />
      <Button
        type='button'
        disabled={progress.busy || !name.trim() || !input.value.value}
        onClick={save}
      >
        {e ? 'Update secret' : 'Add secret'}
      </Button>
      {progress.message && (
        <Section.Note role='status'>{progress.message}</Section.Note>
      )}
    </Rows.Item>
  )
}

let Authorization = () => {
  let privateState = useMemo(() =>
    signal({
      names: [] as string[],
      name: '',
      url: '',
      callback: '',
    }), [])
  let progress = useProgress('authorization')
  let run = (action: 'list' | 'begin' | 'complete') => {
    let { name, callback } = privateState.value
    void progress.run(async () => {
      let reply = await signIn(action, name, callback)
      privateState.value = {
        ...privateState.value,
        callback: '',
        ...reply.servers ? { names: reply.servers } : {},
        url: reply.url ?? '',
      }
      return reply.message ?? ''
    })
  }
  useEffect(() => {
    run('list')
    return () => {
      let { name, url } = privateState.value
      if (url) void signIn('cancel', name).catch(() => {})
      privateState.value = { names: [], name: '', url: '', callback: '' }
    }
  }, [])
  let state = privateState.value
  return (
    <Section>
      <Section.Title>Sign-ins</Section.Title>
      <Section.Sub>Connect a provider using its sign-in link.</Section.Sub>
      <Rows>
        {state.names.map((name) => (
          <Rows.Item key={name}>
            <Button
              disabled={progress.busy}
              onClick={() => {
                privateState.value = { ...state, name }
                run('begin')
              }}
            >
              Sign in to {name}
            </Button>
          </Rows.Item>
        ))}
      </Rows>
      {state.url && (
        <>
          <p>
            <a href={state.url} target='_blank' rel='noreferrer'>
              Open sign-in page
            </a>
          </p>
          <Section.Sub>
            After signing in, paste the complete return URL below.
          </Section.Sub>
          <Field
            type='password'
            aria-label='Sign-in return URL'
            autocomplete='off'
            value={state.callback}
            onInput={(ev: InputEvent) => {
              privateState.value = {
                ...privateState.value,
                callback: (ev.currentTarget as HTMLInputElement).value,
              }
            }}
          />
          <Button
            disabled={progress.busy || !state.callback}
            onClick={() => run('complete')}
          >
            Complete sign-in
          </Button>
        </>
      )}
      {progress.message && (
        <Section.Note role='status'>{progress.message}</Section.Note>
      )}
    </Section>
  )
}

export let Configuration = () => {
  let secrets = useQuery(
    vocab.comp('secret')
      ? `.secret ${vocab.comp('connection') ? '!connection ' : ''}*`
      : '',
  )
  let connections = useQuery(vocab.comp('connection') ? '.connection *' : '')
  return (
    <>
      <Section>
        <Section.Title>Secrets</Section.Title>
        <Section.Sub>
          Values stay in the vault. Enter a replacement value or a 1Password
          reference; saved values are never displayed.
        </Section.Sub>
        <Rows>
          {secrets.map((e) => <Secret key={e.eid} e={e} />)}
          <Secret />
        </Rows>
      </Section>
      {vocab.comp('connection') && (
        <>
          <Authorization />
          <Section>
            <Section.Title>Connections</Section.Title>
            <Rows>
              {connections.map((e) => (
                <Entity key={e.eid} eid={e.eid} view='Tile' />
              ))}
            </Rows>
          </Section>
        </>
      )}
    </>
  )
}
