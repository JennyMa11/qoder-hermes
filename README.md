# Qoder for Pi & Hermes

把 **Qoder**（国内版通义灵码 / 国际版）接入两个 CLI Agent 运行时：

| 目录 | 目标运行时 | 形态 |
| --- | --- | --- |
| [`pi/`](pi/) | [Pi](https://github.com/earendil-works/pi) | 原生 `Provider` 扩展（TypeScript，随 Pi 进程加载） |
| [`hermes/`](hermes/) | [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Model Provider 插件（Python）+ 本地 Node 网关 |
| [`core/`](core/) | 两者共用 | Qoder 协议实现：cosy 签名、jobToken 交换、SSE、目录解析 |

两个接入层都只做「翻译」：Qoder 没有官方 OpenAI 兼容端点，`core/` 把 Qoder 的私有
cosy 协议包装成 OpenAI 形状的流式接口，`pi/` 与 `hermes/` 各自用最自然的方式把它接进宿主。

> **这不是官方集成。** Qoder 的 cosy 接口不是公开稳定 API，上游字段或鉴权方式变动时
> 这里可能需要跟着改；也请自行确认账号与服务条款允许这种用法。

## 架构

```text
        Pi 进程                                 Hermes 进程
┌──────────────────────┐              ┌──────────────────────────┐
│ pi/  Provider        │              │ hermes/ ProviderProfile  │
│  auth / 模型目录      │              │  PAT → 本地网关           │
└──────────┬───────────┘              └────────────┬─────────────┘
           │ OpenAI 形状 HTTP                       │ OpenAI SDK
           ▼                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ core/shim.ts  仅监听 127.0.0.1、随机端口、随机 Bearer secret      │
│   /v1/chat/completions（流式） · /v1/models                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
              core/upstream.ts  cosy 签名 · PAT→jobToken · SSE
                           ▼
              gateway.qoder.com.cn（CN） / api1.qoder.sh（Global）
```

设计上的两条硬约束：

1. **真实 PAT 不交给宿主的模型层。** 宿主拿到的只是一个回环地址和一次性随机 secret；
   PAT 只存在于网关进程内，用完即换 jobToken。Hermes 侧 PAT 经子进程 stdin 传入，
   不进 argv、不进网关环境变量。
2. **不修改宿主源码。** Pi 用公开的 `registerProvider`；Hermes 用官方
   `$HERMES_HOME/plugins/model-providers/` 插件契约（`ProviderProfile`）。

## 安装

两者都要求 **Node.js 22.19+**，并且需要保留本仓库的完整目录（`pi/` 与 `hermes/`
都通过相对路径引用 `core/`）。

### Pi

```bash
pi install /path/to/qoder-pi-hermes/pi
```

重启 Pi，然后 `/login qoder`（国内版）或 `/login qoder-global`（国际版），再 `/model`。
也可以用环境变量 `QODERCN_PERSONAL_ACCESS_TOKEN` / `QODER_PERSONAL_ACCESS_TOKEN`。
细节见 [`pi/README.md`](pi/README.md)。

### Hermes

```bash
cd hermes
pnpm install     # pnpm-workspace.yaml 里把 esbuild 列入 allowBuilds
pnpm build
python3 install.py            # 复制到 $HERMES_HOME/plugins/model-providers/qoder-cn/
hermes auth add qoder-cn --label account-a
hermes model
```

细节见 [`hermes/README.md`](hermes/README.md)。

## PAT

两个区域各发一份、互不通用，形如 `pt-…`。获取方式见 [`docs/PAT.md`](docs/PAT.md)。
不要把 PAT 提交进仓库、贴进 issue 或写进 shell 历史。

## 能力对照

| 能力 | Pi | Hermes |
| --- | --- | --- |
| 国内版 / 国际版 | 两个 Provider：`qoder`、`qoder-global` | 仅国内版 `qoder-cn` |
| 流式回答 | ✅ | ✅ |
| 工具调用 | ✅ | ✅ |
| 动态模型目录 | ✅ `fetchModels` + 静态兜底 | ✅ `/v1/models` + 静态兜底 |
| 思考档位映射 | ✅ | 由网关透传 `reasoning_effort` |
| 多账号池 | ❌ 单 PAT | ✅ 每条池记录独立网关 |
| 签到 / 积分 / 图形设置 | ❌ | ❌ |
| 非流式 `stream:false` | ❌ | ❌ |

账号池、签到、积分与图形设置页属于上游的 DSH 插件形态，这两个接入层不包含。

## 验证

```bash
cd pi     && pnpm install && pnpm run check
cd hermes && pnpm install && pnpm build && pnpm run check
```

`hermes` 的检查会启动真实 `hermes -z` 子进程，在隔离的临时 `HERMES_HOME` 里对着**本地假
Qoder 上游**验证流式文本、工具调用与工具结果回传；`pi` 的检查覆盖模型转换、鉴权解析，
以及经 shim 的流式与工具调用。**全部测试使用 `pt-example-only` 之类假凭据，没有用真实 PAT
打过线上 Qoder**——上游可用性无法由这些测试证明。

## 许可与致谢

协议与目录解析部分来自 [dsh-connect-qoder](https://github.com/dingminhua/dsh-connect-qoder)
（MIT, © 2026 LaoDing），本项目同样采用 MIT 许可，详见 [`LICENSE`](LICENSE)。