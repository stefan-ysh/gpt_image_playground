import { useEffect, useState } from 'react'
import Image from 'next/image'

interface SmoothImageProps {
  src: string
  alt?: string
  className?: string
  imageClassName?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent<HTMLImageElement>) => void
  unoptimized?: boolean
  onLoad?: (e: { currentTarget: { naturalWidth: number; naturalHeight: number } }) => void
  priority?: boolean
  // 如果提供了 width 和 height，则使用固定尺寸；否则使用 fill 并撑满外部 relative 容器
  width?: number
  height?: number
  // 自定义数据属性支持
  'data-image-id'?: string
  'data-output-image-ids'?: string
}

export default function SmoothImage({
  src,
  alt = '',
  className = '',
  imageClassName = '',
  onClick,
  draggable,
  onDragStart,
  unoptimized, // 动态智能判定是否需要优化
  priority = false,
  width,
  height,
  onLoad,
  ...rest
}: SmoothImageProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(src)

  // 当 src 改变时，重置加载状态，从而展示骨架屏，防止闪烁旧图片
  useEffect(() => {
    if (src !== currentSrc) {
      setIsLoaded(false)
      setCurrentSrc(src)
    }
  }, [src, currentSrc])

  const hasSize = width != null && height != null

  // 智能决策：Base64 编码或 Blob 地址因无法交由 Next.js 服务端进行转换裁剪，强制不予优化；普通的网络 URL 允许全额借力 Next.js 的优秀压缩转换，秒速下载！
  const isBase64OrBlob = src.startsWith('data:') || src.startsWith('blob:')
  const shouldDisableOptimization = unoptimized ?? isBase64OrBlob

  return (
    <div
      className={`relative overflow-hidden w-full h-full select-none ${className}`}
      onClick={onClick}
    >
      {/* 1. 微光闪烁骨架屏 (Shimmer Skeleton) */}
      {!isLoaded && (
        <div className="absolute inset-0 shimmer-skeleton z-10 transition-opacity duration-300 pointer-events-none rounded-[inherit]" />
      )}

      {/* 2. Next.js 高阶 Image 组件 */}
      <Image
        src={src}
        alt={alt}
        width={hasSize ? width : undefined}
        height={hasSize ? height : undefined}
        fill={!hasSize}
        priority={priority}
        unoptimized={shouldDisableOptimization}
        draggable={draggable}
        onDragStart={onDragStart}
        onLoad={(e) => {
          setIsLoaded(true)
          onLoad?.(e)
        }}
        className={`object-cover w-full h-full select-none transition-all duration-700 ease-out ${
          isLoaded
            ? 'opacity-100 scale-100 blur-0'
            : 'opacity-0 scale-[0.98] blur-xs'
        } ${imageClassName}`}
        sizes={!hasSize ? '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw' : undefined}
        {...rest}
      />
    </div>
  )
}
