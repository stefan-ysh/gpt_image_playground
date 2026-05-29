import { GptImage2AsyncProvider } from './gpt-image-2-async.js'
import { FreegenZImageProvider } from './freegen-z-image.js'

const gptImage2AsyncProvider = new GptImage2AsyncProvider()
const freegenZImageProvider = new FreegenZImageProvider()

export function getProvider(provider: string) {
  if (provider === 'freegen-z-image') return freegenZImageProvider
  return gptImage2AsyncProvider
}
