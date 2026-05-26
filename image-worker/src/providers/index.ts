import { OpenAICompatibleProvider } from './openai-compatible.js'

const openaiCompatible = new OpenAICompatibleProvider()

export function getProvider(_provider: string) {
  return openaiCompatible
}