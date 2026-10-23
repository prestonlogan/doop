import { createHash } from 'node:crypto'
import { z } from 'zod'
import { env } from './env.ts'
import type { ModelAccount } from './modelAccounts.ts'
import { ACCOUNT_KIND_LABELS, type ModelOption } from '../shared/modelMenu.ts'
import { fetchCatalogJson, loadModelCatalog, type ModelCatalog } from './modelCatalog.ts'

export type DiscoveredKeyKind = 'openai-key'

export function hasApiModelCatalog(kind: ModelAccount['kind']): kind is DiscoveredKeyKind {
  return kind === 'openai-key'
}

const id = z.string().min(1).max(200)
const openaiModel = z.object({ id, created: z.number(), shutdown_date: z.string().nullable().optional() })
const openaiPage = z.object({ data: z.array(z.unknown()).max(10000) })

/* The catalog does not expose tool/vision/transport capabilities. Admit
 * only reviewed general-purpose families, never arbitrary names containing
 * "gpt". New revisions within these families are discovered; new families
 * need a compatibility review. No inference probes or charges.
 * OpenAI: /api/docs/guides/latest-model (Responses, images, tools, reasoning).
 * Anchoring excludes chat-only, Codex-only, research, audio and image variants. */
const OPENAI_AGENT_MODEL =
  /^(?:gpt-(?:5(?:\.\d+)?|6(?:\.\d+)?)(?:-(?:mini|nano|sol|terra|luna|astra))?|o3|o4-mini)(?:-\d{4}-\d{2}-\d{2})?$/

async function openaiModels(apiKey: string, signal: AbortSignal): Promise<ModelOption[]> {
  const page = openaiPage.parse(
    await fetchCatalogJson(new URL(env.OPENAI_MODELS_URL), { Authorization: `Bearer ${apiKey}` }, signal),
  )
  const models = page.data.flatMap((value) => {
    const parsed = openaiModel.safeParse(value)
    if (!parsed.success || !OPENAI_AGENT_MODEL.test(parsed.data.id)) return []
    const model = parsed.data
    if (model.shutdown_date && model.shutdown_date <= new Date().toISOString().slice(0, 10)) return []
    return [model]
  })
  return models
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .map((model) => ({
      id: model.id,
      name: model.id.replace(/^gpt-/, 'GPT-'),
      blurb: '',
      vision: true,
    }))
}

const loaders: Record<DiscoveredKeyKind, (apiKey: string, signal: AbortSignal) => Promise<ModelOption[]>> = {
  'openai-key': openaiModels,
}

export async function getApiModelCatalog(account: ModelAccount): Promise<ModelCatalog> {
  if (!hasApiModelCatalog(account.kind) || !account.apiKey) throw new Error('Reconnect your provider to load models.')
  const kind = account.kind
  const apiKey = account.apiKey
  const identity = createHash('sha256').update(apiKey).digest('hex')
  return loadModelCatalog(`${kind}:${account.userId}`, identity, ACCOUNT_KIND_LABELS[kind], async (signal) => {
    const models = await loaders[kind](apiKey, signal)
    return [...new Map(models.map((model) => [model.id, model])).values()]
  })
}
