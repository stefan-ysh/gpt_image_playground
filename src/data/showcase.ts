import type { TaskParams } from '../types'

export type ShowcaseCategory = 'generate' | 'edit' | 'productivity' | 'creative'

export interface ShowcaseExample {
  id: string
  category: ShowcaseCategory
  title: string
  useCase: string
  mode: 'generate' | 'edit'
  description: string
  prompt: string[],
  params: Partial<TaskParams>
  outputImages: string[]
  inputImages?: string[]
  notes?: string[]
}

export const SHOWCASE_CATEGORIES: Array<{ id: ShowcaseCategory | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'generate', label: '文生图' },
  { id: 'edit', label: '图像编辑' },
  { id: 'productivity', label: '图表 / UI' },
  { id: 'creative', label: '创意商业' },
]

export const SHOWCASE_EXAMPLES: ShowcaseExample[] = [
  {
    id: 'infographic-coffee-machine',
    category: 'productivity',
    title: '咖啡机技术信息图',
    useCase: '信息图',
    mode: 'generate',
    description: '用结构化说明、部件名和流程词，让模型进入“可读图解”模式。',
    prompt: [`Create a detailed Infographic of the functioning and flow of an automatic coffee machine like a Jura.
From bean basket, to grinding, to scale, water tank, boiler, etc.
I'd like to understand technically and visually the flow.`, `创建一个详细的自动咖啡机（如Jura）工作流程和流程图。
从豆篮，到研磨，到称重，水罐，锅炉等。
我想从技术和视觉上理解其流程。`],
    params: { size: '1024x1536', resolution: '2k' },
    outputImages: ['./showcase/infographic_coffee_machine_gpt-image-2.webp']
  },
  {
    id: 'translate-infographic',
    category: 'edit',
    title: '信息图文本翻译',
    useCase: '本地化编辑',
    mode: 'edit',
    description: '保留画面和版式，只替换图片中的文字。',
    prompt: ['Translate the text in the infographic to Spanish. Do not change any other aspect of the image.', '将信息图中的文字翻译成西班牙语。不要改变图像的任何其他方面。'],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: ['./showcase/infographic_coffee_machine_gpt-image-2.webp'],
    outputImages: ['./showcase/infographic_coffee_machine_sp_gpt-image-2.webp'],
  },
  {
    id: 'natural-photorealism',
    category: 'generate',
    title: '自然感纪实摄影',
    useCase: '写实人像 / 场景',
    mode: 'generate',
    description: '直接写 photorealistic，并补充真实材质、自然光和“不摆拍”的约束。',
    prompt: [`Create a photorealistic candid photograph of an elderly sailor standing on a small fishing boat.
He has weathered skin with visible wrinkles, pores, and sun texture, and a few faded traditional sailor tattoos on his arms.
He is calmly adjusting a net while his dog sits nearby on the deck. Shot like a 35mm film photograph, medium close-up at eye level, using a 50mm lens.
Soft coastal daylight, shallow depth of field, subtle film grain, natural color balance.
The image should feel honest and unposed, with real skin texture, worn materials, and everyday detail. No glamorization, no heavy retouching.`, `创建一个逼真的街头照片，展示一位年长的水手站在一艘小渔船上的场景。
他有风化的皮肤，可见的皱纹、毛孔和阳光纹理，手臂上有一些褪色的传统水手纹身。
他平静地调整着渔网，他的狗在甲板上附近坐着。拍摄效果类似于35mm胶片照片，中等近景，从眼睛高度拍摄，使用50mm镜头。
柔和的海岸日光，浅景深，微妙的胶片颗粒，自然的色彩平衡。
图像应该感觉真实且未经摆拍，具有真实的皮肤质感、磨损的材料和日常细节。没有美化，没有重度修图。`],
    params: { size: '1024x1536', resolution: '2k' },
    outputImages: ['./showcase/photorealism-gpt-image-2.webp'],
  },
  {
    id: 'world-knowledge-bethel',
    category: 'generate',
    title: '时代场景与世界知识',
    useCase: '历史 / 地点推理',
    mode: 'generate',
    description: '用地点、日期和时代准确性要求，让模型推断真实背景。',
    prompt: [`Create a realistic outdoor crowd scene in Bethel, New York on August 16, 1969.
Photorealistic, period-accurate clothing, staging, and environment.`, `在1969年8月16日于纽约贝瑟尔创建一个逼真的户外人群场景。
逼真，时代准确的服装，布景和环境。`],
    params: { size: '1024x1536', resolution: '2k' },
    outputImages: ['./showcase/world_knowledge-gpt-image-2.webp'],
  },
  {
    id: 'logo-field-flour',
    category: 'creative',
    title: '原创 Logo 方案',
    useCase: '品牌标志',
    mode: 'generate',
    description: '清楚写出品牌人格、可缩放性、负空间和侵权规避。',
    prompt: [`Create an original, non-infringing logo for a company called Field & Flour, a local bakery.
The logo should feel warm, simple, and timeless. Use clean, vector-like shapes, a strong silhouette, and balanced negative space.
Favor simplicity over detail so it reads clearly at small and large sizes. Flat design, minimal strokes, no gradients unless essential.
Plain background. Deliver a single centered logo with generous padding. No watermark.`, `为一家名为Field & Flour的当地面包店创建一个原创的、不侵权的标志。
标志应该感觉温暖、简单且经久耐玩。使用干净、类似矢量的形状，强烈的轮廓，以及平衡的负空间。
优先考虑简洁而非细节，以便在小尺寸和大尺寸下都能清晰阅读。平面设计，最少的笔画，除非必要否则不使用渐变。
纯色背景。交付一个居中放置的标志，带有充足的内边距。无水印。`],
    params: { size: '1024x1536', resolution: '2k', n: 4 },
    outputImages: [
      './showcase/logo_generation_1_gpt-image-2.webp',
      './showcase/logo_generation_2_gpt-image-2.webp',
      './showcase/logo_generation_3_gpt-image-2.webp',
      './showcase/logo_generation_4_gpt-image-2.webp',
    ],
  },
  // {
  //   id: 'product-ad-design',
  //   category: 'creative',
  //   title: '产品宣传图设计',
  //   useCase: '品牌标志',
  //   mode: 'generate',
  //   description: '生成产品宣传图。',
  //   prompt: [`Using the provided reference image, transform the single casual product photo into a polished e-commerce TVC storyboard board for a {argument name="video duration" default="15-second"} ad in a {argument name="aspect ratio" default="9:16"} vertical format, presented as a 9-panel grid. Keep the same blue-and-white ceramic ashtray as the product base, but restage it across cinematic advertising shots with warm premium lighting, shallow depth of field, and a refined lifestyle desktop environment. Add a dark storyboard layout with Chinese titles and timing for each panel. Include exactly 9 scenes: 1) environment-establishing wide shot with desk, books, window, and the product placed in context; 2) hero product medium shot on the table; 3) extreme close-up of the blue floral craftsmanship pattern; 4) use case showing a hand placing a cigarette into the ashtray with visible smoke; 5) top-down capacity display showing multiple cigarette butts inside; 6) cleaning scene under running water in a sink with a hand holding the product; 7) bottom-detail close-up showing the underside and anti-slip pads; 8) mood/lifestyle scene at night with the product on a desk, smoke rising, and ambient lamp light; 9) brand closing frame with the product as the hero plus Chinese marketing text. Add the overall header text "产品TVC分镜脚本(15秒 / 9:16竖屏 / 9宫格)" and a product subtitle naming it {argument name="product name" default="青花瓷烟灰缸"}. Give each of the 9 panels a Chinese scene title and timestamp, plus small descriptive Chinese copy beneath each image in the style of a professional commercial shot list. Use premium, realistic commercial photography throughout, consistent product identity, elegant Chinese aesthetic, and a clean high-end storyboard presentation.`, `使用提供的参考图像，将单一的休闲产品照片转变为一个精心制作的电子商务TVC分镜板，用于{argument name="video duration" default="15秒"}的广告，采用{argument name="aspect ratio" default="9:16"}的竖屏格式，以9宫格展示。保持相同的蓝白色陶瓷烟灰缸作为产品基础，但在电影广告镜头中重新布置，使用温暖的高级照明、浅景深和精致的生活方式桌面环境。添加一个带有中文标题和每个面板时间的小黑色分镜布局。包括9个场景：1）环境建立的广角镜头，展示桌子、书籍、窗户和放置在上下文中的产品；2）桌子上的英雄产品中景；3）蓝色花卉工艺图案的特写；4）使用场景显示一只手将香烟放入烟灰缸，烟雾可见；5）从上方显示多个烟蒂在内的容量展示；6）在水槽下清洗场景，一只手拿着产品；7）底部细节特写显示底部和防滑垫；8）夜间氛围/生活方式场景，产品在桌子上，烟雾升起，环境灯光；9）品牌结尾框，以产品为主角加上中文营销文本。添加整体标题文本"产品TVC分镜脚本(15秒 / 9:16竖屏 / 9宫格)"和一个命名为{argument name="product name" default="青花瓷烟灰缸"}的产品副标题。给每个面板一个中文场景标题和时间戳，以及每个图像下方的小描述性中文文案，风格类似于专业商业拍摄清单。整个过程中使用高级、逼真的商业摄影，一致的产品身份，优雅的中国美学，以及干净高端的分镜展示。`],
  //   params: { size: '1024x1536', resolution: '2k', n: 4 },
  //   inputImages: ['./showcase/product_ad_1.webp'],
  //   outputImages: [
  //     './showcase/product_ad_1_gpt-image-2.webp',
  //   ],
  // },
  {
    id: 'thread-campaign-ad',
    category: 'creative',
    title: '街头品牌广告',
    useCase: '广告创意',
    mode: 'generate',
    description: '像创意简报一样描述品牌、受众、画面和准确文案。',
    prompt: [`Give me a cool in culture ad / fashion shot for a brand called Thread.
It's a hip young street brand. The ad shows a group of friends hanging out together with the tagline "Yours to Create."
Make it feel like a polished campaign image for a youth streetwear audience: stylish, contemporary, energetic, and tasteful.
Use clean composition, strong color direction, natural poses, and premium fashion photography cues.
Render the tagline exactly once, clearly and legibly, integrated into the ad layout.
No extra text, no watermarks, no unrelated logos.`, `为一个名为Thread的品牌创建一个酷炫的文化广告/时尚照片。
它是一个时尚的年轻街头品牌。广告展示了一群朋友在一起闲逛，标语是"你的创作"。
让它感觉像为年轻街头服饰受众设计的精良活动图像：时尚、现代、充满活力且有品味。
使用干净的构图、强烈的色彩导向、自然的姿势和高端时尚摄影提示。
只渲染标语一次，清晰可读地整合到广告布局中。
不要额外的文字，不要水印，不要不相关的标志。`],
    params: { size: '1024x1536', resolution: '2k' },
    outputImages: ['./showcase/thread_ad_gpt-image-2.webp'],
  },
  {
    id: 'comic-reel',
    category: 'creative',
    title: '四格竖版漫画',
    useCase: '故事转分镜',
    mode: 'generate',
    description: '逐面板写清动作节拍，让叙事节奏更稳定。',
    prompt: [`Create a short vertical comic-style reel with 4 equal-sized panels.
Panel 1: The owner leaves through the front door. The pet is framed in the window behind them, small against the glass, eyes wide, paws pressed high, the house suddenly quiet.
Panel 2: The door clicks shut. Silence breaks. The pet slowly turns toward the empty house, posture shifting, eyes sharp with possibility.
Panel 3: The house transformed. The pet sprawls across the couch like it owns the place, crumbs nearby, sunlight cutting across the room like a spotlight.
Panel 4: The door opens. The pet is seated perfectly by the entrance, alert and composed, as if nothing happened.`, `创建一个简短的竖版漫画，包含4个等大的面板。
面板1：主人从正门离开。宠物被框在他们身后的窗户里，小得可怜，眼睛睁大，爪子按得很高，房子突然安静下来。
面板2：门咔哒一声关上。寂静打破了。宠物慢慢转向空荡荡的房子，姿态发生变化，眼睛因可能性而变得锐利。
面板3：房子发生了变化。宠物像拥有这个地方一样 sprawling 在沙发上，附近的面包屑，阳光像聚光灯一样穿过房间。
面板4：门开了。宠物完美地坐在入口处，警觉而镇定，仿佛什么都没发生过。`],
    params: { size: '1024x1536', resolution: '2k' },
    outputImages: ['./showcase/comic_reel-gpt-image-2.webp'],
  },
  {
    id: 'farmers-market-ui',
    category: 'productivity',
    title: '移动端 UI Mockup',
    useCase: '产品界面图',
    mode: 'generate',
    description: '把产品当成已上线应用来描述，强调真实 UI 元素和层级。',
    prompt: [`Create a realistic mobile app UI mockup for a local farmers market.
Show today's market with a simple header, a short list of vendors with small photos and categories, a small "Today's specials" section, and basic information for location and hours.
Design it to be practical, and easy to use. White background, subtle natural accent colors, clear typography, and minimal decoration.
It should look like a real, well-designed, beautiful app for a small local market.
Place the UI mockup in an iPhone frame.`, `为当地农民市场创建一个逼真的移动应用 UI 模拟。
显示今天的市场，带有简单的标题，一个简短的供应商列表，带有小照片和类别，一个小的"今日特价"部分，以及位置和营业时间的基本信息。
设计它要实用且易于使用。白色背景，微妙的自然强调颜色，清晰的排版，和最少的装饰。
它应该看起来像一个真实、设计良好、美丽的应用，适用于小型当地市场。
将 UI 模拟放在 iPhone 框架中。`],
    params: { size: '1024x1536', resolution: '2k' },
    outputImages: ['./showcase/ui_farmers_market_gpt-image-2.webp'],
  },
  {
    id: 'cellular-respiration',
    category: 'productivity',
    title: '课堂科学图解',
    useCase: '教育视觉',
    mode: 'generate',
    description: '明确受众、教学目标、标签和必须出现的分子。',
    prompt: [`Create a simple biology diagram titled "Cellular Respiration at a Glance" for high school students.

Show how glucose turns into energy inside a cell. Include glycolysis, the Krebs cycle, and the electron transport chain.
Use arrows to connect the steps, and label the main molecules: glucose, pyruvate, ATP, NADH, FADH2, CO2, O2, and H2O.
Make it look like a clean classroom handout or slide, with a white background, simple icons, clear labels, and easy-to-read text.

Avoid tiny text, extra decoration, or anything that makes the diagram hard to understand.`, `为高中生创建一个简单的生物学图表，标题为"细胞呼吸一览"。

展示葡萄糖如何在细胞内转化为能量。包括糖酵解、克雷布斯循环和电子传递链。
使用箭头连接各个步骤，并标注主要分子：葡萄糖、丙酮酸、ATP、NADH、FADH2、CO2、O2和H2O。
让它看起来像一个干净的课堂讲义或幻灯片，带有白色背景，简单图标，清晰标签和易于阅读的文字。

避免使用过小的文字、额外的装饰或任何使图表难以理解的内容。`],
    params: { size: '1536x1024', resolution: '4k' },
    outputImages: ['./showcase/scientific_educational_cellular_respiration_gpt-image-2.webp'],
  },
  {
    id: 'market-opportunity-slide',
    category: 'productivity',
    title: '融资页幻灯片',
    useCase: 'Slide / Chart',
    mode: 'generate',
    description: '把画布、真实数据、层级和视觉语言都写成 artifact spec。',
    prompt: [`Create one pitch-deck slide titled **"Market Opportunity"** that feels like a real Series A fundraising slide from a YC-backed startup.

Use a clean white background, modern sans-serif typography like Inter, and a crisp, minimal layout. The slide should include:

* A TAM/SAM/SOM concentric-circle diagram in muted blues and grays
* Specific, believable market sizing numbers:

  * **TAM:** $42B
  * **SAM:** $8.7B
  * **SOM:** $340M
* A clean bar chart below showing market growth from **2021 to 2026**, with a subtle upward trend
* Small footnotes: **"AGI Research, 2024"** and **"Internal analysis"**
* A company logo placeholder in the bottom-right corner

The design should look like it belongs in a deck that actually raised money: highly readable text, clear data hierarchy, polished spacing, and professional startup-style visual language.

Avoid clip art, stock photography, gradients, shadows, decorative elements, or anything that feels generic or overdesigned.`, `创建一个标题为**"市场机会"**的幻灯片，感觉就像是一个真正的由YC支持的初创公司在进行A轮融资时使用的幻灯片。

使用干净的白色背景，现代无衬线字体如Inter，以及清晰、简约的布局。幻灯片应包括：

* 一个TAM/SAM/SOM同心圆图，使用柔和的蓝色和灰色
* 具体、可信的市场规模数字：

  * **TAM:** 420亿美元
  * **SAM:** 87亿美元
  * **SOM:** 3.4亿美元
* 下方一个干净的柱状图显示2021年至2026年的市场增长，带有微妙的上升趋势
* 小脚注：**"AGI Research, 2024"** 和 **"内部分析"**
* 右下角一个公司标志占位符

设计应该看起来像是属于一个真正筹集资金的演示文稿：高度可读的文本，清晰的数据层次结构，精致的间距，以及专业的初创公司风格的视觉语言。

避免使用剪贴画、库存照片、渐变、阴影、装饰元素或任何感觉通用或过度设计的东西。`],
    params: { size: '1536x864', resolution: '4k' },
    outputImages: ['./showcase/market_opportunity_slide_gpt-image-2.webp'],
  },
  {
    id: 'style-transfer-pixels',
    category: 'edit',
    title: '风格迁移',
    useCase: '参考图风格复用',
    mode: 'edit',
    description: '只复用参考图的视觉语言，同时指定新主体和背景约束。',
    prompt: [`Use the same style from the input image and generate a man riding a motorcycle on a white background.`, `使用输入图像中的相同风格，并在白色背景上生成一个骑摩托车的男人。`],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: ['./showcase/pixels.webp'],
    outputImages: ['./showcase/motorcycle_gpt-image-2.webp'],
  },
  {
    id: 'virtual-try-on',
    category: 'edit',
    title: '虚拟试衣',
    useCase: '电商预览',
    mode: 'edit',
    description: '锁定身份、脸、体态、姿势，只允许替换服装。',
    prompt: [`Edit the image to dress the woman using the provided clothing images. Do not change her face, facial features, skin tone, body shape, pose, or identity in any way. Preserve her exact likeness, expression, hairstyle, and proportions. Replace only the clothing, fitting the garments naturally to her existing pose and body geometry with realistic fabric behavior. Match lighting, shadows, and color temperature to the original photo so the outfit integrates photorealistically, without looking pasted on. Do not change the background, camera angle, framing, or image quality, and do not add accessories, text, logos, or watermarks.`, `编辑图像以用提供的服装图像为女性穿衣。不要以任何方式改变她的脸、面部特征、肤色、体型、姿态或身份。保持她确切的 likeness、表情、发型和比例。只替换服装，使服装自然地适应她现有的姿态和身体几何形状，具有真实的织物行为。将光照、阴影和色彩温度与原始照片匹配，使服装集成得逼真，而不会看起来像是粘贴上去的。不要改变背景、相机角度、构图或图像质量，并且不要添加配件、文字、标志或水印。`],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: [
      './showcase/woman_in_museum.webp',
      './showcase/jacket.webp',
      './showcase/tank_top.webp',
      './showcase/boots.webp',
    ],
    outputImages: ['./showcase/outfit_gpt-image-2.webp'],
  },
  {
    id: 'drawing-to-render',
    category: 'edit',
    title: '草图转写实渲染',
    useCase: 'Sketch to Render',
    mode: 'edit',
    description: '保留草图布局和透视，只补真实材质、光线与环境。',
    prompt: [`Turn this drawing into a photorealistic image.
Preserve the exact layout, proportions, and perspective.
Choose realistic materials and lighting consistent with the sketch intent.
Do not add new elements or text.`, `将这张草图转换为照片级真实的图像。
保持确切的布局、比例和视角。
选择与草图意图一致的真实材质和光照。
不要添加新的元素或文字。`],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: ['./showcase/drawings.webp'],
    outputImages: ['./showcase/realistic_valley_gpt-image-2.webp'],
  },
  {
    id: 'product-clean-background',
    category: 'edit',
    title: '商品白底图',
    useCase: '商品图精修',
    mode: 'edit',
    description: '强调边缘、标签完整度和不要重新设计商品。',
    prompt: [`Extract the product from the input image and place it on a plain white opaque background.
Output: centered product, crisp silhouette, no halos/fringing.
Preserve product geometry and label legibility exactly.
Add only light polishing and a subtle realistic contact shadow.
Do not restyle the product; only remove background and lightly polish.`, `从输入图像中提取产品并将其放置在纯白色不透明背景上。
输出：居中的产品，清晰的轮廓，没有光晕/走样。
精确保持产品几何形状和标签可读性。
只进行轻微的抛光处理，并添加微妙的真实接触阴影。
不要重新设计产品；只移除背景并轻微抛光。`],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: ['./showcase/shampoo.webp'],
    outputImages: ['./showcase/extract_product_gpt-image-2.webp'],
  },
  {
    id: 'billboard-text',
    category: 'edit',
    title: '带真实文字的营销物料',
    useCase: '广告合成',
    mode: 'edit',
    description: '精确引用图片内文案，要求只出现一次且清晰可读。',
    prompt: [`Create a realistic billboard mockup of the shampoo on a highway scene during sunset.
Billboard text (EXACT, verbatim, no extra characters):
"Fresh and clean"
Typography: bold sans-serif, high contrast, centered, clean kerning.
Ensure text appears once and is perfectly legible.
No watermarks, no logos.`, `创建一个真实的广告牌模型，展示洗发水在高速公路场景中的日落效果。
广告牌文字（完全一致，逐字相同，无额外字符）：
"Fresh and clean"
字体：粗体无衬线字体，高对比度，居中，清晰的字符间距。
确保文字只出现一次且完全可读。
无水印，无标志。`],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: ['./showcase/shampoo.webp'],
    outputImages: ['./showcase/billboard_gpt-image-2.webp'],
  },
  {
    id: 'interior-chair-swap',
    category: 'edit',
    title: '室内单物体替换',
    useCase: '精确编辑',
    mode: 'edit',
    description: '只替换一个对象，反复声明镜头、光线、阴影和周边物体不变。',
    prompt: [`In this room photo, replace ONLY white with chairs made of wood.
Preserve camera angle, room lighting, floor shadows, and surrounding objects.
Keep all other aspects of the image unchanged.
Photorealistic contact shadows and fabric texture.`, `在这张房间照片中，只将白色物体替换为木质椅子。
保持相机角度、房间光照、地板阴影和周围物体不变。
保持图像的其他所有方面不变。
照片级真实的接触阴影和织物纹理。`],
    params: { size: '1536x1024', resolution: '4k' },
    inputImages: ['./showcase/kitchen.webp'],
    outputImages: ['./showcase/kitchen-chairs_gpt-image-2.webp'],
  },
  {
    id: 'childrens-book-continuity',
    category: 'creative',
    title: '儿童书角色一致性',
    useCase: '多图工作流',
    mode: 'edit',
    description: '先建立角色锚点，再用参考图延展新场景。',
    prompt: [`Continue the children's book story using the same character.

Scene:
The same young forest hero is gently helping a frightened squirrel
out of a fallen tree after a winter storm.
The character kneels beside the squirrel, offering reassurance.

Character Consistency:
- Same green hooded tunic
- Same facial features, proportions, and color palette
- Same gentle, heroic personality

Style:
Children's book watercolor illustration,
soft lighting, snowy forest environment,
warm and comforting mood.

Constraints:
- Do not redesign the character
- No text
- No watermarks`,`继续使用同一角色的儿童书故事。

场景：
同一个年轻的森林英雄正在温柔地帮助一只受惊的松鼠
从冬季风暴后倒下的树中出来。
角色跪在松鼠旁边，提供安慰。

角色一致性：
- 同样的绿色连帽外套
- 同样的面部特征、比例和色彩方案
- 同样温柔、英雄般的个性

风格：
儿童书水彩插图，
柔和的光线，雪地森林环境，
温暖舒适的氛围。

约束条件：
- 不要重新设计角色
- 无文本
- 无水印`],
    params: { size: '1024x1536', resolution: '2k' },
    inputImages: ['./showcase/childrens_book_illustration_1_gpt-image-2.webp'],
    outputImages: ['./showcase/childrens_book_illustration_2_gpt-image-2.webp'],
  },
]
