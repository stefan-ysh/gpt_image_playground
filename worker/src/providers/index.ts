import { GptImage2AsyncProvider } from './gpt-image-2-async.js'

const gptImage2AsyncProvider = new GptImage2AsyncProvider()

export function getProvider(_provider: string) {
  return gptImage2AsyncProvider
}