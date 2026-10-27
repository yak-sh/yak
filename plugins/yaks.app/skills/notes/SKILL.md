---
name: notes
description: 'App Notes (NOTES.md) (yaks.app). NOTES.md beside index.html: what the person wants written down about how the app is kept, in prose, given to every agent that works on the app — where the file goes and who can read it, what belongs in it and what does not, the 4096-byte size limit, how about and an MCP prompt named after the app give it to an agent, and how a published or installed copy carries it.'
---

# App Notes (NOTES.md)

`NOTES.md` is a prose file beside an app's `index.html` that holds what the
person wants written down about how the app is kept, such as "recipes in grams".
An agent keeps nothing between conversations, so a rule the person states to one
agent is lost when that conversation ends, and they have to state it again to
the next agent. A rule written in `NOTES.md` does not need repeating. The file
is prose, it belongs to the app, and every agent that can reach the app can be
given it.

This page covers where the file goes, what belongs in it and what does not, its
size limit, and the three places an agent is given it.

The map is at <https://yaks.app/docs.md>.

## File location and access

`NOTES.md`, at the app's root, beside `index.html` and `vocab.json`:

    app_files { app: 'recipes', path: 'NOTES.md', content: '…' }

It is part of the app's source, not one of its pages. `GET /recipes/NOTES.md` is
a 404 on the web, the same as `vocab.json` and `worker.js`; a member reads it
back with `app_files`:

    app_files { app: 'recipes', op: 'read', path: 'NOTES.md' }

Anyone who can reach the app can read it, which is everyone in the space. A
stranger with the link cannot, whatever the app's access is.

## Example: a recipe app's NOTES.md

A complete example, for a recipe app, the app people ask this platform for most
often:

    # Recipes

    Weights in grams, never cups. Say the oven in °C with °F in brackets.

    Every ingredient's amount is repeated in the step that uses it — "add the
    200 g flour", not "add the flour" — so nobody scrolls back mid-cook.

    One photo per recipe, of the finished dish, uploaded not linked.

    A recipe that came from somewhere says where in `source`, with the URL.

    Tag by meal (breakfast, dinner, pudding), never by cuisine.

The example follows four rules, and they are the whole test for a line in
`NOTES.md`:

- **Every line is a rule somebody could break.** "Weights in grams" is a rule.
  "This app holds recipes" is not — the connector's own listing states that
  already.
- **It is about the data, not the code.** How a recipe is written down stays the
  same when the page's design changes.
- **No reasoning.** The person knows why they want grams. An agent that reads
  the rule does not need the argument for it.
- **Nothing the graph already holds.** The components, the commands, the address
  and what the app holds are already given to agents (see the next sections). A
  rule that restates them is a second copy that will drift.

## What does not belong in NOTES.md

`NOTES.md` is not documentation of the app and not a changelog. It is not a
place to leave notes for the next agent about unfinished work: put that in the
app's own store, where a task outlives a paragraph in the notes.

It also cannot make an agent do something the agent would refuse. An agent reads
it as the person's standing preference, as input like anything else in a store.

## Size limit

`NOTES.md` holds at most 4096 bytes. A larger write is refused, and the refusal
gives the size:

    NOTES.md is 5200 bytes — 4096 at most. Every agent that can reach the
    app is handed it, so keep it to the app's own notes, not the reasoning
    behind them.

The limit exists because everyone in the space who asks for this text is sent
all of it and pays for it. A page of rules is enough. If the notes grow into a
document, move the rules into `vocab.json` instead: a property the app declares
there is a rule the store itself enforces, so no agent can forget it.

## How agents are given the notes

Agents are given the same text in three places: `about`, an MCP prompt named
after the app, and the platform's builder.

When an agent connects, `initialize` gives the model a passage naming every app
the person can reach, one heading each, with what the app holds and its own
commands, and a line where the app keeps notes:

    ## kitchen/recipes
    https://kitchen.yaks.app/recipes/ — Recipes, holds recipes. Commands:
    add_recipe, find_recipe. Keeps notes of its own, which about hands over.

    ## kitchen/chores
    https://kitchen.yaks.app/chores/ — Chores, holds chores.

The passage also explains how to use those names: an app's own actions are
commands rather than tools in the connector's list, run with the `command` tool
and listed with `commands`.

Because of that passage, an agent asked to "add this recipe" knows there is
already a recipe app to add it to, and does not make a second one. The passage
is generated at every connection. It names the apps but never quotes what their
people wrote.

First, `about` returns the notes themselves: the same list of apps with each
app's own notes under it, and anything the person has said in the space along
with them. Call it before you build on an app or add to one. It is also how a
long conversation learns about apps that changed after it started: an app made
this morning appears in what `about` returns, not in the tool list.

Second, a person can request the notes by name. Each app's notes are offered as
an MCP prompt named after the app — `recipes`, or `recipes__notes` where that
name is already taken — titled "Recipes: notes", so somebody picking from a menu
can add the app's rules to a conversation deliberately.

Third, the platform's builder reads an app's notes before it builds on that app.

## Publishing and installing

`app_publish` and `app_install` copy an app's files, and `NOTES.md` is one of
them. Somebody who installs a published recipe box gets the publisher's
`NOTES.md` along with its pages, in the installer's own copy, which they can
then rewrite with `app_files` like any other file of theirs.

## When to write or update NOTES.md

When the person states a rule that applies beyond the current conversation,
write it into `NOTES.md` without being asked. "Use grams" said in passing is a
standing rule; "make this one metric" is not. If you are not sure, ask in one
line. If they say it twice, write it down.

Read the file before you edit it, and add to it rather than replacing it: the
lines already there are the person's.

---

Back to the map: <https://yaks.app/docs.md>. Related pages: the app's own
components in <https://yaks.app/docs/components.md>, its own commands in
<https://yaks.app/docs/tools.md>, and its files in
<https://yaks.app/docs/files.md>.
