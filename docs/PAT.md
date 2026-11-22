# 获取并配置 Qoder PAT

本项目的两个接入层（[`pi/`](../pi/)、[`hermes/`](../hermes/)）都用 **PAT**（Personal Access
Token）鉴权。这篇只讲三件事：PAT 是什么、从哪拿、怎么填进去，以及它为什么会被拒。

## 一、PAT 是什么

PAT 是 Qoder 官方发给开发者的个人访问令牌，形如 `pt-…`。它有两个性质决定了本项目
的设计：

- **自己签发、自己吊销**：不需要把账号密码交给任何第三方，随时可在设置页删除。
- **等价于账号权限**：泄露它等于泄露账号。不要提交进仓库、贴进 issue 或聊天窗口。

拿到 PAT 后发生的事：

```text
PAT ──(一次性)──> Qoder 网关 /jobToken 交换 ──> jobToken
                                                  │
                                                  ↓
                                    之后每次请求带签名会话头
                                    （PAT 此后不再出现）
```

PAT 只在本地网关进程内参与这次交换。Pi 与 Hermes 的模型调用方拿到的是
`127.0.0.1` 上的回环地址与一次性随机 secret，真正的 PAT 不进入宿主的模型 API 层。

## 二、从哪里拿

两个区域各发一份，**互不通用**：

| 区域 | 服务站点 | 发证入口 |
| --- | --- | --- |
| 国内版（通义灵码） | `qoder.com.cn` | 登录 [Qoder CN 控制台](https://www.alibabacloud.com/help/zh/lingma/cloud-agents-cn/api-authentication) → **设置 → API 令牌** → 创建令牌 |
| 国际版 | `qoder.sh` | 登录 Qoder 控制台 → **Settings → Personal Access Tokens** → 创建（见 [Qoder 官方认证文档](https://docs.qoder.com/cloud-agents/api/conventions/authentication)） |

创建时：

1. 给令牌起个名字（只给自己看，比如「Pi 笔记本」）。
2. 若页面要求选权限范围 / 有效期，按需选择——本项目只用模型推理能力，默认即可；
   有有效期的记得到期后重签。
3. 点创建。**令牌通常只完整显示一次**，当场复制保存。

> 这是 Qoder **控制台网页版**的入口，不是桌面客户端的设置页。

## 三、怎么填进去

### Pi

```bash
pi install /path/to/qoder-pi-hermes/pi
# 重启 Pi 之后：
/login qoder          # 国内版，粘贴 pt-…
/login qoder-global   # 国际版
/model                # 选模型
```

或者不写 `auth.json`，用环境变量：

```bash
export QODERCN_PERSONAL_ACCESS_TOKEN='pt-…'   # 国内版
export QODER_PERSONAL_ACCESS_TOKEN='pt-…'     # 国际版
```

两者同时存在时，Pi 已保存的 PAT 优先。

### Hermes

```bash
hermes auth add qoder-cn --label account-a   # 在隐藏提示里粘贴，不进 shell 历史
hermes model                                 # 选 Qoder CN (PAT) 与模型
```

也可以写进 `~/.hermes/.env`：

```dotenv
QODERCN_PERSONAL_ACCESS_TOKEN=pt-…
```

**不要同时配两个来源**，Hermes 会按自己的优先级挑一个。Hermes 侧只有国内版
（`qoder-cn`）；国际版请在 Pi 里用 `qoder-global`。

两处都**不要**把 Base URL 改成 Qoder 官网地址：`qoder-cn` 的 `qoder-cn://local/v1`
是插件自己的占位符，真实端点由本地网关动态决定。

## 四、常见问题

### `401 personal token is invalid`

这条错误来自 **PAT → jobToken 的认证交换**，也就是你还没进到模型调用就被拒了。按顺序排查：

1. **区域错了。** 国内版令牌不能用在 `qoder-global`，反之亦然。最常见的原因是拿了
   国际版令牌填进 CN，或把桌面客户端/网页登录态误当 PAT。
2. **复制带了空白或换行。** 令牌应当是一个连续字符串，末尾不能有空格。
3. **令牌已过期或被吊销。** 回控制台重新签发一张。
4. **令牌本身有效但不能做推理。** 见下一节。

本项目在登录时会先做一次真实交换，失败即拒绝写入，所以「保存成功」本身就说明
PAT 至少能换到 jobToken。

### 令牌明明是新生成的，某些接口仍 401

2026-10 在 CN 令牌上实测到的现象，值得记下来：

| 请求 | 结果 |
| --- | --- |
| `api.qoder.com.cn/api/v1/cloud/agents` | **200** —— 令牌有效、账号正常 |
| `openapi.qoder.com.cn/sash/api/v2/me/usage` | 401 `TOKEN_EXPIRE / token is not active` |
| `openapi.qoder.sh/sash/api/v2/me/usage` | 401 `TOKEN_EXPIRE` |
| `gateway.qoder.com.cn/algo/api/v2/model/list` | 403 `Signature invalid` |

两个结论：

1. **判断令牌是否有效，不能只看单一端点。** `sash` 系列回 `TOKEN_EXPIRE` 时令牌本身
   可能完全正常——那条路径预期的是浏览器会话 cookie，不是 PAT。
2. **`gateway.*/algo/*` 必须走 cosy 签名**，裸 `Bearer` 一律 `Signature invalid`。
   本项目走的正是「PAT → jobToken → 签名会话」这条路，所以聊天与模型列表不受上面那条
   401 影响。

### 模型列表是空的

未配置 PAT 的区域不列出模型——列出来也只会点到就失败。确认 `/login` 或环境变量就位后
刷新一次（Pi：`/qoder-refresh`；Hermes：`hermes model`）。

### 国际版还需要设备风控头

国际版请求要带 `Cosy-MachineToken` / `Cosy-MachineCode` / `Cosy-MachineType`，三件套由
本机 Qoder 客户端的 UMID 组件生成（国内版不需要，多发反而是噪音）。组件路径：

| 区域 | macOS |
| --- | --- |
| 国内版 | `/Applications/Qoder CN.app/Contents/Resources/umid/runtime-info` |
| 国际版 | `/Applications/Qoder.app/Contents/Resources/umid/runtime-info` |

找不到组件时，国际版请求会如实报错而不是静默降级；可用 `QODER_UMID_PATH` 显式指定。
Windows 上按两层找：默认安装目录 `%LOCALAPPDATA%\Programs\Qoder[ CN]\resources\umid\runtime-info.exe`，
以及卸载登记表里的 `InstallLocation`（安装器允许换盘）。

## 五、不在本项目范围内的东西

上游的 DSH 插件还带账号池、每日签到与积分/倍率卡片。本项目只做「把模型接进 CLI
Agent」，因此：

- **账号池**：Hermes 侧通过它自己的凭据池支持多 PAT；Pi 侧单 PAT。
- **签到 / 积分 / 倍率**：不包含。相关协议文档与实现留在上游
  [dsh-connect-qoder](https://github.com/dingminhua/dsh-connect-qoder) 仓库。