/**
 * DragonCode GPT-Image-2 花费估算。
 * 文档规则：完成任务后按请求中的 resolution 档位计费，每任务固定 1 张图片。
 * 单价通过环境变量配置（服务器 .env），默认值为占位，请按 DragonCode 后台实际账单价调整：
 *   DRAGON_PRICE_1K / DRAGON_PRICE_2K / DRAGON_PRICE_4K（美元）
 */
const CURRENCY = process.env.DRAGON_PRICE_CURRENCY || '$';

const UNIT_PRICES: Record<'1k' | '2k' | '4k', number> = {
  '1k': Number(process.env.DRAGON_PRICE_1K ?? 0.05),
  '2k': Number(process.env.DRAGON_PRICE_2K ?? 0.11),
  '4k': Number(process.env.DRAGON_PRICE_4K ?? 0.25),
};

export function getUnitPrice(resolution: string | null | undefined): number {
  const key = resolution === '1k' || resolution === '4k' ? resolution : '2k';
  return UNIT_PRICES[key];
}

export function getUnitPrices(): { currency: string; prices: Record<'1k' | '2k' | '4k', number> } {
  return { currency: CURRENCY, prices: { ...UNIT_PRICES } };
}

export function formatCost(amount: number): string {
  return `${CURRENCY}${amount.toFixed(2)}`;
}
