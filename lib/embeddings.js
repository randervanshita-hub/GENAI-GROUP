// Local, open-source embeddings: BAAI's bge-small-en-v1.5 (384 dimensions),
// run on CPU through ONNX Runtime. Free, no API quota, and the filings text
// never leaves our own server for this step. The model files ship in models/.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline, env } from '@huggingface/transformers'

export const EMBED_MODEL = 'bge-small-en-v1.5 (local)'
export const EMBED_DIMS = 384
const MODEL_ID = 'Xenova/bge-small-en-v1.5'
// bge models retrieve best when the query (not the passage) carries this instruction.
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

env.localModelPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models')
env.allowRemoteModels = false

let extractor
async function load() {
  extractor ??= pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
  return extractor
}

/**
 * Embed texts. kind is 'passage' or 'query'.
 * Returns { vectors, model, inputTokens, costInr } in the same shape the pipeline logs.
 */
export async function embed(texts, kind) {
  const fe = await load()
  const inputs = kind === 'query' ? texts.map((t) => QUERY_PREFIX + t) : texts
  const vectors = []
  for (let i = 0; i < inputs.length; i += 32) {
    const out = await fe(inputs.slice(i, i + 32), { pooling: 'cls', normalize: true })
    vectors.push(...out.tolist())
  }
  const inputTokens = inputs.reduce((n, t) => n + Math.ceil(t.length / 4), 0)
  return { vectors, model: EMBED_MODEL, inputTokens, costInr: 0 }
}
