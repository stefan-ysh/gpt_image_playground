import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile, DRAGONCODE_PROVIDER_ID } from './apiProfiles'
import { normalizeResolution } from './resolution'
import { normalizeImageSize, isSupported4KRatio } from './size'

export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    resolution: normalizeResolution(params.resolution, DEFAULT_PARAMS.resolution),
    n: 1,
  }

  if (activeProfile.provider === DRAGONCODE_PROVIDER_ID) {
    if (nextParams.resolution === '4k' && !isSupported4KRatio(nextParams.size)) {
      nextParams.resolution = '2k'
    }
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
