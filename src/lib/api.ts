import { getActiveApiProfile, getCustomProviderDefinition, isFreegenProfile } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callFreegenImageApi } from './freegenImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (isFreegenProfile(profile)) return callFreegenImageApi(opts, profile)
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)

  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
