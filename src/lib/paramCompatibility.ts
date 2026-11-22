import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile, DRAGONCODE_PROVIDER_ID } from './apiProfiles'
import { normalizeResolution } from './resolution'
import { normalizeImageSize, isSupported4KRatio, toDragonSizeRatio } from './size'

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
    // DragonCode 要求 size 为比例字符串（1:1/16:9/auto），由像素尺寸换算并吸附到支持列表
    nextParams.sizeRatio = toDragonSizeRatio(nextParams.size) ?? undefined
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
