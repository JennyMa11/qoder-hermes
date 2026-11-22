# Qoder CN — Hermes Agent Provider

把 Qoder 国内版 PAT 接入 Hermes 原生 `ProviderProfile`。Hermes 始终使用 OpenAI-compatible
客户端；本地 Node 网关负责 PAT → jobToken、cosy 协议、SSE 和工具调用转换。**不需要修改
Hermes 核心，也不需要常驻手工启动服务。**

## 要求

- Hermes Agent v0.23.3（本机实测版本）
- Node.js 22.19+
- Qoder 国内版 PAT。国际版（`qoder.sh`）令牌互不通用，填进来会在认证交换阶段被拒。

## 安装

```sh
cd hermes
pnpm install
pnpm build
python3 install.py
```

安装目标是 `$HERMES_HOME/plugins/model-providers/qoder-cn/`（默认 `~/.hermes`）。只复制
`__init__.py`、`runtime.py`、`usage.py`、`plugin.yaml` 和 `gateway.mjs`，不依赖源码目录继续存在。仓库里的
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

- 已实现：单 PAT、动态模型目录、流式文本、工具调用、非流式调用、多 PAT 池、积分余额显示、进程退出清理。
- 不包含：Qoder 国际版、签到（每日领取）操作。
- Qoder cosy 是私有上游协议，字段或鉴权方式改变时网关可能需要同步更新。
- 没有配置真实 PAT 时不能进行线上验证；测试使用本地假 Qoder 上游，不代表上游服务可用性。

## 非流式调用

Qoder 上游只有 SSE，本网关自己把 delta 聚合成标准的 `chat.completion`。这条路径不是可选的：
Hermes 的**辅助任务**——智能审批、标题生成、上下文压缩、Vision 判定——都发普通的
`create()`（不带 `stream`，期望 `.choices[0].message`）。网关拒掉它们时主对话看起来完全正常，
但每一轮都会在日志里留下 `Auxiliary: main provider qoder-cn is unavailable`，并退化成人工
审批。OpenAI 语义是「`stream` 缺席即 false」，所以网关也按这个判据分流。

工具调用在同一路径上按 `index` 归并分帧的 `arguments`，聚合结果可直接
`json.loads()`；有工具调用且正文为空时 `content` 是 `null`（OpenAI 语义）。

## 上下文窗口

网关的 `/v1/models` 会带上上游声明的 `context_length` 与 `max_tokens`，并在回答前列一次
上游目录。Hermes 把 `/models` 当作上下文窗口的**唯一**来源：缺这两个字段时它会退回 256K 的
硬默认并打一条 `Could not detect context length ... (probe-down)`，压缩阈值也跟着按错的窗口
算。

只读端点（`/v1/models`、`/healthz`）额外接受本网关自己的 PAT —— Hermes 的元数据探测带的
正是它当前持有的 api_key，走 `.env` 时那就是原始 PAT。计费端点（`POST /v1/chat/completions`）
仍然只认随机 secret，所以「PAT 不当 API key 发给上游」这条约束不变。

## 积分余额

```sh
hermes usage --provider qoder-cn          # 人类可读
hermes usage --provider qoder-cn --json   # 机器可读
```

插件实现 Hermes 的 `fetch_account_usage` hook，走的是本账号自己的回环网关（`GET /v1/usage`），
所以 PAT 仍然只留在网关进程里，不会为了查余额再发给别处。`/usage` 在会话里也会显示同一份数据。

口径（与 DSH 卡片一致）：基础额度 `userQuota` 与加油包 `addOnQuota` 按 `total` 计，组织包
`orgResourcePackage` 按 `cap` 计，三者剩余相加就是「Credits remaining」；`size <= 0` 的包跳过。
`expiresAt` 是**账号套餐/试用到期**，不是积分到期，因此只作为一行 `Plan expires: YYYY-MM-DD`，
不做成倒计时窗口。国际版的专属资源包（`dedicatedResourcePackages`）只对特定模型生效，不并入
总额 —— 并进去会显示一个用户实际花不掉的数字；国内版本来也不返回这个字段。

一个坑值得记下：`hermes usage` 的加载顺序和普通对话不同 —— `agent.account_usage` 在半初始化
状态下来请求插件 profile，所以插件里任何模块级的 `from agent.account_usage import ...` 都会让
`ImportError` 被插件加载边界吞掉，表现出来就是「这个 provider 没有 usage 端点」，而且只有
`hermes usage` 会坏。映射代码因此在函数体内导入，`hermes/test/cli_e2e.py` 也用真实
`hermes usage` 断言这份数据。

第二个坑：会话内 `/usage` 给 hook 的是路由里的 `api_key`/`base_url`，而那对值是
`prepare_pool_entry` 换过的**回环网关 secret**，不是 PAT。把 secret 当 PAT 去 Qoder 换
jobToken 必然 401，hook 又是 fail-open，于是整段余额静默消失 —— 命令行 `hermes usage` 因为
传 `api_key=None` 反而一直正常。插件现在的解析顺序是：先在自己已持有的网关里按 secret
认领（插件重载后旧网关可能已不在表里），再按 `base_url` 认到会话实际在用的那个账号，最后才
判断手里是不是 `pt-` 开头的 PAT，否则回落 Hermes 的凭据解析。多账号池下这一步尤其重要：
`resolve_runtime_provider` 只会解析出其中一个 PAT，可能是别的账号的。

插件升级后，长驻的桌面 gateway 仍跑着旧快照（`~/.hermes/runtime/provider-plugins/` 下按
进程冻结），此时 `/usage` 会缺这一段而命令行正常。重载即可：

```sh
hermes gateway restart
```

不想中断会话时，可以直接对该 profile 的控制 socket（`$HERMES_HOME/gateway.sock`）发一条
`reload-plugins` 动词：运行中的 gateway 会强制重新发现插件，把新快照冻结进
`runtime/provider-plugins/` 供之后的会话使用。这也是一次性 CLI 能立刻看到新版本、桌面端却
要等一次重载的原因。

## 验证

```sh
pnpm install
pnpm build
pnpm run check
python3 test/gateway_e2e.py
python3 test/usage_unit.py
```

`pnpm run check` 会额外通过真实 `hermes -z` 进程验证流式对话、工具执行及工具结果回传，使用
隔离的临时 `HERMES_HOME`，不改动真实配置；随后再用真实 `hermes usage` 断言积分数据能穿过
插件与网关读出来。`pnpm-workspace.yaml` 的 `allowBuilds` 只放行本包
唯一声明需要构建脚本的依赖 `esbuild`（用于打 bundle）；运行网关本身不需要它，安装到 Hermes
后也不依赖本目录。

`hermes/test/hermes_integration.py` 和 `hermes/test/plugin_smoke.py` 需要在 Hermes bootstrap
后的环境中运行，使用其 managed Python；直接 `python3` 运行不是 Hermes 的运行时。测试均使用
`pt-example-only` 等假值和本地假上游，不使用真实账号。

这两个测试通过 `hermes/test/isolated_home.py` 把 `HERMES_HOME` 指向系统临时目录下的
`qoder-cn-test-home`。这不是洁癖：Hermes 用 `override=True` 加载 `$HERMES_HOME/.env`，而
`_resolve_api_key_provider_secret` 的取值顺序刻意优先 `.env` 而非 `os.environ`，所以只
`patch.dict(os.environ)` 的测试仍会读到开发者本人的 PAT，`plugin_smoke` 的「未配置即安全」
断言就会假失败。目录固定而非每次 `mkdtemp` 是因为 Hermes 按 home 激活独立依赖环境，每跑一次
新建会多花几分钟；需要换位置时设 `QODER_CN_TEST_HOME`。

## 卸载

```sh
hermes auth reset qoder-cn   # 只重置冷却状态，不会删除 PAT
hermes plugins remove qoder-cn
```

删除 PAT 请使用 `hermes auth remove qoder-cn <序号或label>`；若使用 `.env`，手动移除
`QODERCN_PERSONAL_ACCESS_TOKEN`。卸载不会自动更改 Hermes 默认 provider/model。
