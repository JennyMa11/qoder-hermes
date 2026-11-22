# core — Qoder 协议实现

Hermes 插件的协议层。没有原生（native addon）依赖，也不引用任何 DSH 包；只依赖 Node
内置模块与 `fetch`，由 esbuild 打成单个文件随插件分发。

| 文件 | 职责 |
| --- | --- |
| [`upstream.ts`](upstream.ts) | Qoder 上游 HTTP 客户端：cosy 签名、PAT→jobToken 交换、聊天 SSE、模型目录、用量与错误分类 |
| [`shim.ts`](shim.ts) | 回环 OpenAI 兼容网关：`/v1/chat/completions`（仅流式）、`/v1/models`、Host/Origin/secret 校验、账号故障转移 |
| [`catalog.ts`](catalog.ts) | 模型目录解析：上游 DTO → 内部模型信息、静态兜底目录、区域/路由器模型过滤 |
| [`cosy.ts`](cosy.ts) | cosy 传输体编解码（RSA + AES） |
| [`messages.ts`](messages.ts) | OpenAI messages → Qoder 模板、`applyModelKey`、工具定义转换 |
| [`promo.ts`](promo.ts) | 促销/倍率解析与显示 |
| [`native-modality.ts`](native-modality.ts) | 模型 ID 与原生多模态能力的判定 |
| [`device-risk.ts`](device-risk.ts) | 国际版设备风控头（UMID 组件探测、进程内缓存） |
| [`failover-notice.ts`](failover-notice.ts) | 账号故障转移的提示文案 |
| [`status-paths.ts`](status-paths.ts) | 区域端点常量与（上游 DSH 用的）Web 路由常量 |

相对上游 [dsh-connect-qoder](https://github.com/dingminhua/dsh-connect-qoder) 的改动集中在
`shim.ts`，都是为了让 Hermes 这个宿主真能用起来（DSH 那侧行为不变：相关回调都是可选的）：

| 改动 | 为什么 |
| --- | --- |
| 可选 `listModelIds` | `/v1/models` 能返回真实目录；不传时仍返回空数组。 |
| 可选 `modelLimitsOf` | 目录条目带上游声明的 `context_length`/`max_tokens`。Hermes 只从 `/models` 读窗口，缺了就退回 256K 硬默认。 |
| 可选 `refreshModels` | 回答 `/v1/models` 前先刷新目录，避免把启动时的静态兜底数字固化进宿主的窗口缓存。 |
| 支持 `stream:false` | 把上游 SSE 聚合成 `chat.completion`。Hermes 的辅助任务（审批/标题/压缩）只走非流式。 |
| 只读端点接受本进程 PAT | Hermes 的窗口探测带的是它持有的 api_key（`.env` 路径下就是 PAT）。计费端点仍只认随机 secret。 |

`stream` 的判据也改成了 OpenAI 语义「缺席即 false」。原先写作 `!== false`，导致不带该字段
的请求被当成流式、回了一段 SSE 给期待 JSON 的客户端；这是 Hermes 日志里
`Auxiliary: main provider qoder-cn is unavailable` 的根因。

`status-paths.ts` 里带 `DSH`/`dsh-connect-qoder` 字样的 Web 路由常量、`shim.ts` 里的
`hostFailureMessage` 文案映射，都是为 DSH 宿主准备的；本项目只用到其中的上游域名常量
（`QODER_UPSTREAM_DOMAIN`）与错误文案，未做裁剪以降低与上游同步的成本。

这些文件按 MIT 许可沿用上游版权，见根目录 [`LICENSE`](../LICENSE)。