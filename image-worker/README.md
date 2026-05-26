# Cosmorigin Image Worker

生产级 Node Worker 项目，用于托管 `gpt_image_playground` 的任务生命周期。

功能：

* provider generation 提交
* provider task polling
* 结果恢复
* COS 图片转存
* MySQL 状态机
* WebSocket 实时通知
* 多 worker 锁
* 指数退避
* 页面刷新不断链

---

# 一、目录结构

```txt
worker/
├── package.json
├── tsconfig.json
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── src/
    ├── index.ts
    ├── config.ts
    ├── logger.ts
    ├── types.ts
    ├── db/
    │   ├── pool.ts
    │   └── tasks.ts
    ├── providers/
    │   ├── types.ts
    │   ├── openai-compatible.ts
    │   ├── fal.ts
    │   └── index.ts
    ├── services/
    │   ├── worker-loop.ts
    │   ├── task-runner.ts
    │   ├── polling.ts
    │   ├── image-transfer.ts
    │   ├── notifier.ts
    │   └── sync.ts
    ├── websocket/
    │   └── ws-server.ts
    └── utils/
        ├── backoff.ts
        ├── sleep.ts
        └── errors.ts
```

---

# 二、package.json

```json

```

---

# 三、tsconfig.json

```json

```

---

# 四、.env.example

```env

```

---

# 五、src/config.ts

```ts

```

---

# 六、src/logger.ts

```ts

```

---

# 七、src/types.ts

```ts

```

---

# 八、src/db/pool.ts

```ts

```

---

# 九、src/db/tasks.ts

```ts

```

---

# 十、src/providers/types.ts

```ts

```

---

# 十一、src/providers/openai-compatible.ts

```ts

```

---

# 十二、src/providers/fal.ts

```ts

```

---

# 十三、src/providers/index.ts

```ts

```

---

# 十四、src/utils/backoff.ts

```ts

```

---

# 十五、src/services/notifier.ts

```ts

```

---

# 十六、src/websocket/ws-server.ts

```ts

```

---

# 十七、src/services/image-transfer.ts

```ts

```

---

# 十八、src/services/task-runner.ts

```ts

```

---

# 十九、src/services/worker-loop.ts

```ts

```

---

# 二十、src/index.ts

```ts

```

---

# 二十一、Dockerfile

```dockerfile

```

---

# 二十二、docker-compose.yml

```yaml
version: '3.9'

services:
  image-worker:
    build: .
    restart: unless-stopped
    env_file:
      - .env
```

---

# 二十三、前端接入方式

Next.js 前端 submitTask 改成：

```ts
await fetch('/api/generation-tasks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt,
    params,
  }),
})
```

不要再直接 call provider generation。

---

# 二十四、前端 WebSocket

```ts
const ws = new WebSocket('ws://localhost:3210')

ws.onmessage = async (event) => {
  const payload = JSON.parse(event.data)

  if (payload.type === 'task_updated') {
    const res = await fetch(`/api/tasks/${payload.taskId}`)
    const task = await res.json()

    // update zustand store
  }
}
```

---

# 二十五、下一阶段

下一阶段建议：

1. provider adapter 真正接入
2. Responses API
3. COS 图片下载与上传
4. thumbnail worker
5. image dedupe
6. task sync API
7. admin panel
8. metrics
9. Prometheus
10. Redis queue
11. BullMQ
12. SSE fallback
13. graceful shutdown
14. worker heartbeat
15. distributed lock
