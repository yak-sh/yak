# @yaks/chat

Chat platforms as plugins. Discord, Slack, Telegram: each is a value its own
package gives (`Platform`), and this package names none of them. It reads what a
platform heard as a `Said`, keeps it as rows, says it to whoever answers it, and
cuts an answer to fit, so a host wires every platform the same way.

## Stored data

- `chat_message{via, room, author, message_id, reply_to, at, addressed, connection}`
  is one message said in a room, its words in @yaks/doc's `doc{body}`: the
  platform it was said on (its plugin's name), the room and the account that
  said it (refs), the platform's id for it and for the message it answers, when,
  how it was said to the bot that heard it (`addressed`: a `mention`, a `reply`
  to the bot, or `direct`), and the connection whose bot heard it. With
  @yaks/mail's `deliver{to}` naming a room, it asks to be posted there by that
  bot: the `chat_post` effect hands it to the poster its host lends for the
  platform (`Host.chatters`) and writes `delivered` or `bounced`. A message to
  post may carry buttons (`chat_message{controls}`, each `{id, label}`). One
  wearing `chat_private{to}` is for that one account alone: its words are never
  posted, only `notice(eid, to)`, a line pinging them alone with a Show me
  button whose id is `PRIVATE` and the row's eid.
- `chat_room{via, id, server, name}` is a place messages are said: a channel, a
  direct conversation, a chat. `server` is the server or workspace it belongs
  to, none for a direct one.
- `chat_account{via, id, name}` is someone on a platform. Which person here they
  are is said by that person's connection to the platform's sign-in
  (@yaks/connections, its `account` their platform id), never on this row.

- `chat_hears{room}`, on a chat connection, is the room of its server where its
  owner's listener hears every message, not only those said to its bot: the
  room's eid (`roomEid`), which names it in every store.
- `chat_serves{servers}`, on the connection of a bot a space brought, is the
  servers that bot is in, as its platform last said (a socket's step `servers`:
  all of them, or one joined or left).

Each eid is derived from `via` and the platform's id (`messageEid`, `roomEid`,
`accountEid`), so a message heard twice writes one row, and two platforms' ids
never meet. `kept(via, said, connection?)` is the three rows, the message naming
the connection whose bot heard it.

## A platform

```ts
type Platform = {
  name: string // what `integration.chat` names (@yaks/connections)
  title: string
  limit: number // the most characters one message carries
  socket?: (credential: string) => Socket<unknown>
  send: (credential: string, reply: Reply, fetch?) => Promise<Posted>
  server?: (
    credential: string,
    room: string,
    fetch?,
  ) => Promise<string | undefined>
  rooms?: (credential: string, server: string, fetch?) => Promise<Room[]>
  recent?: (credential, room, page: Page, fetch?) => Promise<Said[]>
  named?: (credential, server, name: string, fetch?) => Promise<void>
  api?: { base: string; scheme: string; reads: string[] }
  open?: (credential, room, fetch?) => Promise<boolean>
  basics?: (credential, room, people: string[], fetch?) => Promise<Basics>
  working?: { every: number; show: (credential, room, fetch?) => Promise<void> }
}
```

A platform that sends its messages over a socket gives it as pure steps
(`Socket`): where to connect, and for each frame what to send back, how often to
beat, what was heard, who is about (`present`, each account's status), and
whether to connect again; and what a beat sends, or `again` when the last went
unanswered. `ends(code)` says why a close cannot be tried again with the same
credential, and `closed(state, code)`, where a close is answered by asking less
(Discord's refused intents), what the socket remembers as it connects again. A
platform that posts to a webhook instead gives that the way @yaks/phone's
providers do; none does yet.

`send` posts a reply with a bot's credential. A refusal that never took it (a
rate limit, a 5xx) is @yaks/host's `Unsent`, so it is tried again.

`server` says which server a room belongs to, as the bot sees it, none for a
direct room. `confined(chatter, {serves, server})` is a chatter that posts only
into rooms of the servers its connection serves and refuses anything else before
the chatter sees it, so a host can lend a bot to whoever writes rows without
holding it (an app) and still keep its posts in those servers.
`within(at,
serves, server)` is that refusal alone, which a host reads a room's
`recent` messages by too.

`rooms` lists the rooms of a server people write in (`{id, name}`), where the
platform can, so a space chooses the one it hears in full (`chat_hears`).

`recent` reads back a room's messages said before one (`{before, limit}`),
oldest first, where the platform keeps them: none `addressed`, and a bot's own
among them. `since(said, last)` is those after the bot's last answer there, and
`recounted(said, mine)` says them a line each, its ids first as `framing` says
them (`(message 10, replying to 9)`), the bot's own as said by "you".

`named` gives a bot a name of its own in one server, where the platform lets a
bot go by one per server (Discord's nickname), so a bot shared by many spaces,
or one a space brought, goes by the name of the Operator it speaks for there.

`working` is how a bot shows a room it is working on an answer, where the
platform can (Discord's typing indicator): one show lasts `every` milliseconds.
`showing(working, still)` shows at once and again each `every` while `still()`
says the work goes on, for at most ten minutes; a show refused for now
(`Unsent`) waits for the next beat.

`api` is what a bot may read of the platform's API for people there, as data:
its `base`, the `scheme` a bot's credential is sent after in the authorization
header, and the paths any member of a room could read (`reads`), where
`{server}` and `{room}` name where it is read and any other `{name}` is one
segment. `reading(api, path)` is the ids a path binds, none where no read
matches, so a host confines a read to its bot's servers before the platform is
asked. `open` says whether every member of a room's server sees it, which a room
nobody named the bot in is read by.

`basics` is what a person in a room sees without asking (`Basics`): the server
and its icon, the room and its topic, and the people talking with their roles
there. `setting(platform, basics, names)` says it, each id given for `api`.

`framing(platform, {name, addressed})` is how a message is said before its words
to whoever answers it ("On Discord, naming you, from Ann: ").
`pieces(text, limit)` cuts an answer at the last paragraph, line or space that
fits.

## Holding a socket

`holder(socket, {heard, seated, present, pressed})` (`@yaks/chat/socket`) runs a
platform's steps over a `Wire` its host opens: `url()` to connect to,
`frame(wire, text)` for each frame, `beat(wire)` when one is due, and
`ended(code)`. Each answers what the host does next: beat every `every`
milliseconds, or close and connect `again`. What the socket remembers survives a
reconnect, so a session is resumed. The host only connects, keeps time and
closes.

`listener(hosting)` (`@yaks/chat/listen`) is the loop a host runs around a
holder for as long as it lives: given the platform, the bot's credential, how to
open a socket, where heard messages go, and where presses go with the credential
to answer them, its `alarm` opens the socket when it is not open, and the host
calls it every `WATCH` (a minute), so a socket dropped by a deploy is open again
within one. It beats when due, connects again when told or dropped, and stops
only on a close the platform says is final (`ended`), until `close()` forgets
the session, as when the credential changes.

## Presses

A button on a bot's message (a `Reply`'s `controls`) that someone presses
arrives as a step's `pressed`: a `Press` naming the control's id, who pressed
it, the room and message, and what answering takes. A platform that answers a
press for its presser alone gives `presses` (`Presses`): `hold` takes it at
once, as the platform waits only moments, and `answer` says the `Answer`, words
and buttons, in its place. That is how something in a room reaches one person
alone (Discord's ephemeral messages, which a bot can send only in answer to a
press or a command).

Platforms: [@yaks/discord](../discord/README.md).

## Who answers

Whether a message is answered is never a platform's call. A platform says only
how it was `addressed`; the listener reads everything it hears, and answers when
it is addressed or the words are clearly for it, by the conversation logic every
channel shares (@yaks/session's `turn`, which a group text uses too).
