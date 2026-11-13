# Messages

A church's texting on yaks.app, beside its Church Directory in the same space
(Locust Grove Church, at https://locustgrove.yaks.app/messages/). The office
writes a message once and sends it to a list; the people it went to and what
became of each text are on the message. When someone texts back, it lands in a
shared inbox that everyone the church makes an editor of this app reads and
answers. Private: only the app's members open it, and only owners and editors
send.

The people are the directory's. `individual` and `congregation` are the
directory app's words, declared in vocab.json as uses, so this app reads them
and keeps none of its own copy. What this app keeps sits on the same eids:

- `group{}` with `doc{title}` is a list; seed.json makes General and Prayer.
- `membership{group, person}` puts a person on a list; its eid is derived from
  both, so adding someone twice is one row.
- `phone{number}` on a person is the number this app texts them at, written from
  their directory phone whenever they join a list or a message goes out.
- `sms_consent{person, consent, at}` is what they agreed to: the church's words
  when the office adds them to a list, or the text they sent first when the
  office answers someone who wrote in.
- `broadcast{group}` with `doc{body}` is one message to a list, and each of its
  texts carries `copy{broadcast}`.
- A text is `text{}` with `doc{body}` and `deliver{to}`; the platform writes
  `delivered{at}` or `bounced{at, reason}` on it. A text that arrives is
  `text{from, to, at}` with `doc{body}` and no author; answering a conversation
  marks its texts `archived`, and a new one brings it back.

STOP and HELP are the platform's to answer. Someone who texted STOP (and not
START since) is opted out, worked out from their texts, so a list skips them and
the office cannot add them back. Texts go out from the church's own number and
carry no name prefix. The platform's answer to HELP gives the office number kept
as `help{contact}`, which the page copies from the directory. A message over 160
characters goes as one picture message (MMS), up to 2,048; the line carries 100
texts a day, so a send that passes it leaves the rest "not sent", to be sent
again. Until the church's number has a 10DLC campaign, US carriers block its
group texts: the page asks `./api/line` for the number and the campaign recorded
beside it, and the Send dialog says so before a message goes, without stopping
it.

`model.js` holds all of it as pure functions over the store's rows, `views.js`
the screens, and `app.js` the page that wires them to `./api/client.js`. Run
`deno task test apps/messages`. Git is the app's source:
`yak admin push apps/messages --as admin --space locustgrove`.
