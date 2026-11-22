# 获取并配置 Qoder PAT

本项目（[`hermes/`](../hermes/)）用 **PAT**（Personal Access Token）鉴权。这篇只讲三件事：
PAT 是什么、从哪拿、怎么填进去，以及它为什么会被拒。

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

PAT 只在本地网关进程内参与这次交换。Hermes 的模型调用方拿到的是 `127.0.0.1` 上的回环地址
与一次性随机 secret，真正的 PAT 不进入宿主的模型 API 层。

## 二、从哪里拿

本项目只支持**国内版**令牌。国际版令牌与国内版互不通用，填进来一定在认证交换阶段被拒。

| 区域 | 服务站点 | 发证入口 |
| --- | --- | --- |
| 国内版（通义灵码） | `qoder.com.cn` | 登录 [Qoder CN 控制台](https://www.alibabacloud.com/help/zh/lingma/cloud-agents-cn/api-authentication) → **设置 → API 令牌** → 创建令牌 |

创建时：

1. 给令牌起个名字（只给自己看，比如「Hermes 笔记本」）。
2. 若页面要求选权限范围 / 有效期，按需选择——本项目只用模型推理能力，默认即可；
   有有效期的记得到期后重签。
3. 点创建。**令牌通常只完整显示一次**，当场复制保存。

> 这是 Qoder **控制台网页版**的入口，不是桌面客户端的设置页。

## 三、怎么填进去

### Hermes

```bash
hermes auth add qoder-cn --label account-a   # 在隐藏提示里粘贴，不进 shell 历史
hermes model                                 # 选 Qoder CN (PAT) 与模型
```

也可以写进 `~/.hermes/.env`：

```dotenv
QODERCN_PERSONAL_ACCESS_TOKEN=pt-…
```

**不要同时配两个来源**，Hermes 会按自己的优先级挑一个。

两处都**不要**把 Base URL 改成 Qoder 官网地址：`qoder-cn` 的 `qoder-cn://local/v1`
是插件自己的占位符，真实端点由本地网关动态决定。

## 四、常见问题

### `401 personal token is invalid`

这条错误来自 **PAT → jobToken 的认证交换**，也就是你还没进到模型调用就被拒了。按顺序排查：

1. **拿错了令牌。** 最常见的是把国际版（`qoder.sh`）令牌、桌面客户端凭据或网页登录态
   当成国内版 PAT。
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
| `gateway.qoder.com.cn/algo/api/v2/model/list` | 403 `Signature invalid` |

两个结论：

1. **判断令牌是否有效，不能只看单一端点。** `sash` 系列回 `TOKEN_EXPIRE` 时令牌本身
   可能完全正常——那条路径预期的是浏览器会话 cookie，不是 PAT。
2. **`gateway.*/algo/*` 必须走 cosy 签名**，裸 `Bearer` 一律 `Signature invalid`。
   本项目走的正是「PAT → jobToken → 签名会话」这条路，所以聊天与模型列表不受上面那条
   401 影响。

### 模型列表是空的

未配置 PAT 时不列出模型——列出来也只会点到就失败。确认 `hermes auth add` 或环境变量就位后
运行一次 `hermes model` 刷新。

### 设备风控头

国内版不需要设备风控头，`core/` 默认也不发。相关逻辑（UMID 组件探测）只为兼容上游协议
保留，本项目不启用。

## 五、不在本项目范围内的东西

上游的 DSH 插件还带账号池、每日签到与积分/倍率卡片。本项目只做「把模型接进 CLI
Agent」，因此：

- **账号池**：Hermes 侧通过它自己的凭据池支持多 PAT。
- **签到 / 积分 / 倍率**：不包含。相关协议文档与实现留在上游
  [dsh-connect-qoder](https://github.com/dingminhua/dsh-connect-qoder) 仓库。