export interface ImageDimensions {
  width: number
  height: number
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

export async function getImageDimensions(dataUrl: string): Promise<ImageDimensions> {
  const image = await loadImage(dataUrl)
  return { width: image.naturalWidth, height: image.naturalHeight }
}

export async function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png'): Promise<Blob> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: fallbackType })
}

export async function imageDataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

export async function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('图片导出失败'))
      else resolve(blob)
    }, type, quality)
  })
}

export const DEFAULT_MASK_WORKING_MAX_EDGE = 1920
export const MASK_WORKING_DIMENSION_MULTIPLE = 16

export interface MaskWorkingSize {
  width: number
  height: number
  scale: number
  wasResized: boolean
}

export interface PreparedMaskTarget extends MaskWorkingSize {
  dataUrl: string
  originalWidth: number
  originalHeight: number
  wasConvertedToPng: boolean
}

function floorToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function localBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片导出失败'))
    reader.readAsDataURL(blob)
  })
}

export function calculateMaskWorkingSize(
  width: number,
  height: number,
  maxEdge = DEFAULT_MASK_WORKING_MAX_EDGE,
  multiple = MASK_WORKING_DIMENSION_MULTIPLE,
): MaskWorkingSize {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= maxEdge) {
    return {
      width,
      height,
      scale: 1,
      wasResized: false,
    }
  }

  const scale = maxEdge / longestEdge
  return {
    width: floorToMultiple(width * scale, multiple),
    height: floorToMultiple(height * scale, multiple),
    scale,
    wasResized: true,
  }
}

export async function prepareMaskTargetDataUrl(dataUrl: string): Promise<PreparedMaskTarget> {
  const image = await loadImage(dataUrl)
  const size = calculateMaskWorkingSize(image.naturalWidth, image.naturalHeight)
  const isPng = /^data:image\/png(?:[;,]|$)/i.test(dataUrl)

  if (!size.wasResized && isPng) {
    return {
      ...size,
      dataUrl,
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
      wasConvertedToPng: false,
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, size.width, size.height)

  const blob = await canvasToBlob(canvas, 'image/png')
  return {
    ...size,
    dataUrl: await localBlobToDataUrl(blob),
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
    wasConvertedToPng: true,
  }
}
