---
doc:
  title: Workflow Steps From Claude Code
guide:
  slug: steps
  brief: workflow steps your own agent does, such as Claude Code on your own subscription
  description: >-
    A workflow step done by the person's own agent: Claude Code, or any agent
    connected to yaks.app's MCP, doing the work on their own computer with its
    own tools, models and subscription, spending nothing from the space's
    budget. Writing an agent step (a builder whose tool is builder_agent),
    the step task it waits as, step_list and step_answer, uploading files to
    ./api/blob with a grant token, connecting Claude Code, and the command
    the person pastes so Claude Code does the waiting steps, once or on a
    /loop.
---

# Workflow Steps From Claude Code

A step of a [workflow](./code.md) can be done by the person's own agent: Claude
Code, or any agent connected to yaks.app's MCP. It does the work on their
computer, with its own tools, models and subscription, and answers the step's
outputs. The workflow waits for the answer and carries on from it. An agent step
spends nothing from the space's budget, so a pipeline that runs many model or
media jobs can run them on the person's own plan.

## Writing an agent step

An agent step is a builder whose tool is `builder_agent`, whose id is
`45ee9195-562c-87c2-98bc-e7d6fcf76576` (`agentToolEid()` in
`@yaks/builders/agent`). Its `content.body` is the step's instructions, with the
query's variables filled in for each match, and says which outputs to answer:

    {
      entity: { eid: '$script' },
      doc: { title: 'Write the script' },
      content: {
        body: 'Write the script for a short voiced video.\n' +
          'Title: $title\nWhat it is about: $brief\n' +
          'Answer one output per line, slots "line 1", "line 2" and so on: ' +
          'components line {"video": the video id, "n": its number} and ' +
          'doc {"body": the words said}.',
      },
      builder: {
        query: '$v .video, doc.title=$title, doc.body=$brief',
        to: '45ee9195-562c-87c2-98bc-e7d6fcf76576',
        immediate: true,
      },
    }

For each match, the store writes a **step**: a task titled with the builder's
title and the matched row's (`Write the script: Lighthouse`), whose `doc.body`
is the instructions and the ids of the input rows, and whose `agent_step{call}`
names the builder call it answers. The step stays open until the agent answers
it. When its inputs change first, a new step replaces it and the old one is
cancelled. Every other step of the workflow is written as usual: a step that
reads the agent step's outputs (`.built.slot=line 1, built.current=true`) runs
once they exist.

Asked "my own agent does this step", the Operator writes the step this way.

## The two tools

- `step_list(app)` lists the steps waiting: each its `step` id, `title`,
  `instructions` and `binding`, the input rows' ids in `entities` and the
  query's variables in `vars`. A step whose last answer the store refused also
  has `failed`, saying why.
- `step_answer(app, step, outputs)` answers one. `outputs` are what a worker
  answers ([Backend Code](./code.md)): each `{slot, inputs, components}`, where
  `slot` is a unique name, `inputs` lists the binding's entity ids it used, and
  `components` are the row's components. The answer becomes the step's outputs,
  and the step closes. An answer that is not this shape is refused at once. One
  the store refuses as it writes, such as a component the app does not have,
  stays in `step_list` with `failed`.

A file the step makes, such as a voiced line or a cut video, goes to the app
first. Get a token with `grant` (`space` set to the app's space), then post the
bytes:

    curl -X POST https://<space>.yaks.app/<app>/api/blob \
      -H "authorization: Bearer $TOKEN" \
      -H 'content-type: audio/mpeg' -H 'x-yak-name: line-1.mp3' \
      --data-binary @line-1.mp3

It answers `{"eid": …, "url": …}`; name the `eid` in the output's components,
such as `voicing: {"audio": "<eid>"}`. A file of 32 MiB or more goes in parts
([Files and Uploads](./files.md)).

## Setting up Claude Code

1. Connect yaks.app:
   `claude mcp add --transport http --scope user yaks https://yaks.app/mcp`,
   then in Claude Code type `/mcp`, pick **yaks** and choose **Authenticate**.
2. Save this as `.claude/commands/yaks-steps.md` in the folder where the
   pipeline's scripts are (or in `~/.claude/commands/` for every folder):

```markdown
---
description: Do the yaks.app workflow steps waiting for my own agent
argument-hint: <app>
---

Do the workflow steps waiting for my own agent in the yaks.app app $ARGUMENTS.

1. Call step_list with app $ARGUMENTS. If no step is waiting, say so and stop.
2. For each step, read its instructions and binding. Do the work here, with the
   tools, scripts and models on this computer.
3. Upload each file the step makes to the app's ./api/blob with a token from
   grant, and name the eid it answers in the output's components.
4. Answer with step_answer: the step id, and the outputs its instructions ask
   for, each {slot, inputs, components}, inputs being the binding's entity ids
   it used.
5. If step_answer refuses, or step_list shows the step again with failed, fix
   the answer and send it again.
```

3. Run `/yaks-steps <app>` whenever steps are waiting, or
   `/loop 10m /yaks-steps <app>` to keep doing them as they arrive.

The full guide: <https://yaks.app/docs.md>
