# Qoder CN for Hermes Agent

把 **Qoder 国内版（通义灵码）** 接入 [Hermes Agent](https://github.com/NousResearch/hermes-agent)：
一个官方 `ProviderProfile` 插件 + 一个本地 Node 网关。

| 目录 | 作用 |
| --- | --- |
| [`hermes/`](hermes/) | Hermes Model Provider 插件（Python）+ 本地网关 bundle |
| [`core/`](core/) | Qoder 协议实现：cosy 签名、PAT→jobToken、SSE、模型目录 |
| [`docs/PAT.md`](docs/PAT.md) | PAT 从哪拿、怎么填、为什么会被拒 |

Hermes 始终用 OpenAI-compatible 客户端，而 Qoder 没有官方 OpenAI 端点。所以插件只做翻译：
`core/` 把 Qoder 的私有 cosy 协议包成 OpenAI 形状的流式接口，`hermes/` 用官方插件契约把它
接进 Hermes，不改 Hermes 源码，也不需要手工常驻一个服务。

> **这不是官方集成。** Qoder 的 cosy 接口不是公开稳定 API，上游字段或鉴权方式变动时
> 这里可能需要跟着改；也请自行确认账号与服务条款允许这种用法。

## 架构

```text
                        Hermes 进程
              ┌──────────────────────────┐
              │ hermes/ ProviderProfile  │
              │  PAT → 本地网关           │
              └────────────┬─────────────┘
                           │ OpenAI SDK
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ core/shim.ts  仅监听 127.0.0.1、随机端口、随机 Bearer secret      │
│   /v1/chat/completions（流式） · /v1/models                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
              core/upstream.ts  cosy 签名 · PAT→jobToken · SSE
                           ▼
              gateway.qoder.com.cn（CN）
```

两条硬约束：

1. **真实 PAT 不交给宿主的模型层。** Hermes 拿到的只是一个回环地址和一次性随机 secret；
   PAT 经子进程 stdin 传入（不进 argv、不进网关环境变量），只在网关进程内换 jobToken。
2. **不修改宿主源码。** 只用官方 `$HERMES_HOME/plugins/model-providers/` 插件契约。

## 安装

要求 **Hermes Agent v0.23.3+**、**Node.js 22.19+**，并保留本仓库完整目录（`hermes/` 通过相对
路径引用 `core/`，因此不能只拷贝 `hermes/`）。

```bash
git clone https://github.com/JennyMa11/qoder-hermes.git
cd qoder-hermes/hermes
pnpm install
pnpm build
python3 install.py            # 复制到 $HERMES_HOME/plugins/model-providers/qoder-cn/
hermes auth add qoder-cn --label account-a
hermes model
```

细节见 [`hermes/README.md`](hermes/README.md)。

## PAT

国内版 PAT 形如 `pt-…`，在 Qoder CN 控制台「设置 → API 令牌」创建。获取方式与排错见
[`docs/PAT.md`](docs/PAT.md)。不要把 PAT 提交进仓库、贴进 issue 或写进 shell 历史。

## 能力

| 能力 | 状态 |
| --- | --- |
| 流式回答 | ✅ |
| 非流式 `stream:false` | ✅ 网关本地聚合 |
| 工具调用 | ✅ |
| 动态模型目录 | ✅ `/v1/models` + 静态兜底 |
| 上下文窗口透传 | ✅ 上游声明的 `context_length` |
| 思考档位 | 网关透传 `reasoning_effort` |
| 多账号池 | ✅ 每条池记录独立网关 |
| Qoder 国际版 | ❌ 仅国内版 |
| 签到 / 积分 / 图形设置 | ❌ |

非流式不是可选项：Hermes 的辅助任务（智能审批、标题生成、上下文压缩）走普通 `create()`，
Qoder 上游只有 SSE，所以由网关把 delta 聚合成标准 `chat.completion`。缺了它主对话照常，
但每轮都会退化成人工审批。

账号池、签到、积分与图形设置页属于上游的 DSH 插件形态，本项目不包含。

## 验证

```bash
cd hermes && pnpm install && pnpm build && pnpm run check
```

检查会启动真实 `hermes -z` 子进程，在隔离的临时 `HERMES_HOME` 里对着**本地假 Qoder 上游**
验证流式文本、工具调用与工具结果回传。**全部测试使用 `pt-example-only` 之类假凭据，没有用
真实 PAT 打过线上 Qoder**——上游可用性无法由这些测试证明。

## 许可与致谢

协议与目录解析部分来自 [dsh-connect-qoder](https://github.com/dingminhua/dsh-connect-qoder)
（MIT, © 2026 LaoDing），本项目同样采用 MIT 许可，详见 [`LICENSE`](LICENSE)。