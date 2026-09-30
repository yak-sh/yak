# @yaks/model2vec

Embeds text in-process with a
[Model2Vec](https://github.com/MinishLab/model2vec) static model. A static model
is a table with one vector per token; a text's vector is the mean of its tokens'
rows, at length 1. That is a tokenizer pass and a sum: about a millisecond for a
500-token text on one core, with no native code, no thread pool, and no network
once the model is loaded. The same code runs on a server, in a Worker and in a
browser tab, and answers the same vector in each; it matches Model2Vec's own
`encode` exactly.

What a static model gives up against a transformer is context: a token means the
same thing wherever it stands, and a long text's mean says less than a short
one's.

## Use

```ts
import { model2vec } from '@yaks/model2vec'

let embedder = model2vec({
  model: 'minishlab/potion-retrieval-32M@6fc8051',
  dim: 256,
})
// let v = await embedder.embed('a dragon asleep on its gold')
```

`model2vec()` answers an embedder in the shape [@yaks/embedding](../embedding)
takes, `{ model, embed }`. Nothing is fetched until the first embed, which waits
for the model; every embed after it is synchronous. The model's `tokenizer.json`
and `model.safetensors` come from the Hugging Face hub and are kept in the
platform's `caches`, so a later process reads them from disk. The same model
named twice in one process is loaded once. A load that fails rejects the embeds
waiting on it and is tried again on the next.

| Option  | Meaning                                                                |
| ------- | ---------------------------------------------------------------------- |
| `model` | the hub repo, pinned to a revision: `owner/name@rev`                   |
| `dim`   | keep this many leading columns of the table (default: all)             |
| `max`   | read at most this many tokens of a text (default 512, Model2Vec's own) |
| `hub`   | the hub's root (default `https://huggingface.co`)                      |
| `fetch` | the fetch to call through (default: the global one)                    |

Pin the revision. An unpinned `model` fetches `main` once and keeps what it got,
so two machines can hold two different models under one name. The embedder's
`model`, the name every stored vector carries, is the pinned repo and its width:
`minishlab/potion-retrieval-32M@6fc8051#256`.

`dim` works because a Model2Vec table's columns come out of a PCA, most variance
first: its leading columns are the model at a smaller width, the way Model2Vec's
own `dimensionality` loads one. The narrower table is what is kept in memory.

## As @yaks/embedding's embedder

```json
{
  "use": "@yaks/embedding",
  "with": {
    "embedder": {
      "provider": "model2vec",
      "model": "minishlab/potion-retrieval-32M@6fc8051",
      "dim": 256
    }
  }
}
```

## Pieces

- `load(model, files, { dim?, max? })` builds the embedder from the two files
  already in hand.
- `embedder(model, encode, table, { max?, chars?, unk? })` is the arithmetic
  over any tokenizer's ids and a token table.
- `table(bytes, dim?)` reads the `embeddings` tensor of a safetensors file. A
  file in a newer layout (per-token weights, a vocabulary mapping) or of another
  dtype than F32 is refused rather than read wrong.
- `space(said)` is the name a config's vectors live under.

Tokenizing is
[@huggingface/tokenizers](https://www.npmjs.com/package/@huggingface/tokenizers),
loaded with the first model.
