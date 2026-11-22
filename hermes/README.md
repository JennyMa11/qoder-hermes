# Qoder CN — Hermes Agent Provider

把 Qoder 国内版 PAT 接入 Hermes 原生 `ProviderProfile`。Hermes 始终使用 OpenAI-compatible
客户端；本地 Node 网关负责 PAT → jobToken、cosy 协议、SSE 和工具调用转换。**不需要修改
Hermes 核心，也不需要常驻手工启动服务。**

## 要求

- Hermes Agent v0.23.3（本机实测版本）
- Node.js 22.19+
- Qoder 国内版 PAT。不要把国际版 PAT 填到这里；Pi 扩展提供单独的 `qoder-global`。

## 安装

```sh
cd hermes
pnpm install
pnpm build
python3 install.py
```

安装目标是 `$HERMES_HOME/plugins/model-providers/qoder-cn/`（默认 `~/.hermes`）。只复制
`__init__.py`、`runtime.py`、`plugin.yaml` 和 `gateway.mjs`，不依赖源码目录继续存在。仓库里的
`gateway.mjs` 是已构建产物（`pnpm build` 会重新生成），因此安装不要求本机有 esbuild。
修改代码后重新执行 `pnpm build && python3 install.py`，并重启 Hermes。

```sh
hermes plugins validate .
hermes plugins list
```

## 单 PAT

二选一，**不要同时配置多个来源**，否则 Hermes 会按自身优先级选择：

1. 在 `~/.hermes/.env` 写入你自己的 PAT：

   ```dotenv
   QODERCN_PERSONAL_ACCESS_TOKEN=你的PAT
   ```

2. 或加入 Hermes 凭据池（推荐，便于以后添加账号）：

   ```sh
   hermes auth add qoder-cn --label account-a
   # 在隐藏提示中粘贴 PAT；不要把 PAT 写进 shell 历史或仓库。
   ```

然后运行 `hermes model`，选择 **Qoder CN (PAT)** 和需要的模型。也可以用：

```sh
hermes --provider qoder-cn -m qwen3.5-plus -z "你好"
```

模型名以 `hermes model` 拉取到的目录为准。Qoder 网关只支持流式 chat completions；
Hermes 的正常聊天路径使用流式。原始 PAT 不会作为 OpenAI API key 发给任何服务。

## 多账号池

每个账号执行一次，在隐藏提示中输入对应 PAT：

```sh
hermes auth add qoder-cn --label account-a
hermes auth add qoder-cn --label account-b
hermes auth list qoder-cn
hermes auth priority qoder-cn account-a 0
```

- 每条池记录保存原始 PAT 和不可路由的 `qoder-cn://local/v1` 占位 URL；不会保存随机端口。
- 选中账号时，插件为它创建独立回环网关，并在内存中把池项转换为本地 URL + 随机 secret。
- Hermes 轮换凭据时复用对应网关；不会把 A 账号的 PAT 发给 B 账号的网关，也不会把本地
  secret 当成 PAT 发到 Qoder。
- 401/429 的冷却和轮换策略由 Hermes 凭据池负责；**这不是绕过 Qoder 限额的工具**，请遵守
  服务条款和各账号限制。
- PAT 通过子进程 stdin 传入，不出现在 argv 或网关环境变量中。Hermes
  自身的 `auth.json` / `.env` 仍按 Hermes 的凭据安全模型保存原始 PAT，请保护这些文件。

## 当前范围与风险

- 已实现：单 PAT、动态模型目录、流式文本、工具调用、多 PAT 池、进程退出清理。
- 不包含：Qoder 国际版、签到/积分 UI、非流式 `stream: false`。
- Qoder cosy 是私有上游协议，字段或鉴权方式改变时网关可能需要同步更新。
- 没有配置真实 PAT 时不能进行线上验证；测试使用本地假 Qoder 上游，不代表上游服务可用性。

## 验证

```sh
pnpm install
pnpm build
pnpm run check
python3 test/gateway_e2e.py
```

`pnpm run check` 会额外通过真实 `hermes -z` 进程验证流式对话、工具执行及工具结果回传，使用
隔离的临时 `HERMES_HOME`，不改动真实配置。`pnpm-workspace.yaml` 的 `allowBuilds` 只放行本包
唯一声明需要构建脚本的依赖 `esbuild`（用于打 bundle）；运行网关本身不需要它，安装到 Hermes
后也不依赖本目录。

`hermes/test/hermes_integration.py` 和 `hermes/test/plugin_smoke.py` 需要在 Hermes bootstrap
后的环境中运行，使用其 managed Python；直接 `python3` 运行不是 Hermes 的运行时。测试均使用
`pt-example-only` 等假值和本地假上游，不使用真实账号。

## 卸载

```sh
hermes auth reset qoder-cn   # 只重置冷却状态，不会删除 PAT
hermes plugins remove qoder-cn
```

删除 PAT 请使用 `hermes auth remove qoder-cn <序号或label>`；若使用 `.env`，手动移除
`QODERCN_PERSONAL_ACCESS_TOKEN`。卸载不会自动更改 Hermes 默认 provider/model。
