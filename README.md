<div align="center">

# 🎨 Cosmorigin Image Studio

**科源起源 (Cosmorigin) 内部专用多模型图像生成与编辑系统**

提供简洁精美的 Web UI，支持 OpenAI 兼容图像接口以及自定义企业级异步/同步 HTTP 图像服务商。<br>
支持文本生图、参考图与遮罩编辑，数据纯本地化安全缓存，提供流畅的历史任务管理与实际生效参数审计体验。

</div>

---

## 📸 界面预览

<details>
<summary><b>点击展开截图展示</b></summary>
<br>

<div align="center">
  <b>桌面端主界面</b><br>
  <img src="docs/images/example_pc_1.jpg" alt="桌面端主界面" />
</div>

<br>

<div align="center">
  <b>任务详情与计费参数</b><br>
  <img src="docs/images/example_pc_2.jpg" alt="任务详情与计费参数" />
</div>

<br>

<div align="center">
  <b>桌面端批量归类与管理</b><br>
  <img src="docs/images/example_pc_3.jpg" alt="桌面端批量归类与管理" />
</div>

<br>

<div align="center">
  <b>移动端主界面</b><br>
  <img src="docs/images/example_mb_1.jpg" alt="移动端主界面" width="420" />
</div>

</details>

---

## ✨ 核心特性

### 🎨 图像生成与局部重绘
- **主流接口支持**：原生对接 `Images API` (`/v1/images`) 和 `Responses API` (`/v1/responses`) 协议。
- **图生图与遮罩编辑器**：支持上传多达 16 张参考图，内置高精度可视化遮罩（Mask）区域编辑器，智能重构与预处理。
- **COS 转存与本地去重**：所有参考图及生成图在 COS 云端转存时自动计算 SHA-256 去重压缩，大幅节省企业级存储开销。
- **流式接收预览**：Responses API 模式下支持流式接收生成中的图像切片，缓解 HTTP 连接超时与阻塞问题。

### ⚙️ 精细化参数审计与计费展示
- **实际参数追踪对比**：自动提取 API 实际响应的真实生效尺寸、质量、耗时，与前端请求值进行高亮比对。
- **计费解析系统**：支持从通用异步任务响应中解析 `data.cost` 或 `cost` 花费，并在任务详情区格式化为 `$0.05279` 类浮点型花费直观渲染，实现精准成本控制。
- **智能规整限制**：内置 1K/2K/4K 分辨率快速档位，自定义尺寸时自动规整为模型所需的 16 像素倍数。

### 🔐 强健的内部生态集成与数据隐私
- **跨库登录态联查**：免登录集成，自动读取 Cosmorigin 内部管理后台种下的 `finance_session` Cookie，并跨库联查 `admin_cosmorigin.hr_employees` 表来校验用户身份。
- **多用户物理隔离**：系统数据库以用户 ID 进行强物理隔离，任何历史记录及图片只在当前登录人下可见。
- **IndexedDB 本地缓存**：图片及任务快照采用本地 IndexedDB 进行高速缓存，不经过第三方服务器，同时支持一键 ZIP 压缩打包备份。

---

## 🚀 本地开发与容器部署

### 💻 方式一：本地开发调试

**1. 准备配置文件**

在项目根目录创建 `.env.local` 配置文件：

```env
# 内部共享的 MySQL 连接配置
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=image_studio  # 自动创建的 Image Studio 专用隔离数据库

# COS 云存储转存配置
COS_SECRET_ID=your_cos_secret_id
COS_SECRET_KEY=your_cos_secret_key
COS_BUCKET=your-cos-bucket-12345
COS_REGION=ap-shanghai

# 每人每日成功生成图片数量限制，可按需调整
PLAYGROUND_DAILY_IMAGE_LIMIT=60
```

每日额度按北京时间（Asia/Shanghai）自然日统计。

**2. 安装依赖并启动**

```bash
npm install
npm run dev
```

打开浏览器访问 `http://localhost:3000` 即可开始使用。


---

## 🔌 API 快速导入与 URL 填充

应用支持通过 URL 查询参数快速填入配置，非常适合内部工具集成与分享：

- `?apiUrl=https://your-api-gateway.com/v1`：自动填入代理网关地址。
- `?apiMode=images` 或 `?apiMode=responses`：填入图像生成模式。
- `?model=gpt-image-2`：自动填入默认的模型名。

API Key 统一读取环境变量 `NEXT_PUBLIC_DEFAULT_API_KEY`。

---

## 🛠️ 内部技术架构

*   **前端核心**：React 19, TypeScript, Next.js (App Router)
*   **状态管理**：Zustand 5
*   **样式方案**：Tailwind CSS 3
*   **后端服务**：Next.js Server Actions / API Routes (Node.js runtime)
*   **持久化层**：MySQL 8 (本地连接池，首选自动初始化 DDL) + Tencent COS (腾讯云对象存储转存镜像)
*   **通信与流式**：JSON Server Sent Events (SSE) 流式传输

---

<div align="center">

**Cosmorigin (科源起源) 技术中心研发部 © 2026**

</div>
