# Qoder for Pi

把 Qoder 国内版 / 国际版接入 [Pi](https://github.com/earendil-works/pi) 的原生扩展。基于 `dsh-connect-qoder` 的协议核心，但不依赖 DSH。

## 安装

需要 Node.js 22.19+ 与 Pi 1.5.0+。这是**本地目录扩展**：从完整仓库安装并保持该目录存在（`core/` 必须在），不能只复制或单独发布 `pi/` 子目录，因为协议实现位于仓库根部的 `core/`。

```bash
pi install /path/to/qoder-pi-hermes/pi
```

然后**重新启动 Pi**。首次安装依赖时可能需要一两分钟。

## 登录（二选一）

在 Pi 里运行 `/login qoder`，粘贴国内版 PAT；国际版用 `/login qoder-global`。登录时会向上游验证 PAT，凭据由 Pi 的 `auth.json` 保存。

也可以在启动 Pi 前设置环境变量（不要提交到项目）：

```bash
export QODERCN_PERSONAL_ACCESS_TOKEN='你的国内版 PAT'
# export QODER_PERSONAL_ACCESS_TOKEN='你的国际版 PAT'
```

环境变量适合不想把 PAT 写入 `auth.json` 的情况。两种来源同时存在时，Pi 已保存的 PAT 优先。

PAT 获取方式见[原项目说明](../docs/PAT.md)。

## 使用

- `/model`：选择 `qoder` 或 `qoder-global` 下的模型；可按 `Ctrl+R` 刷新目录。
- `/qoder-refresh`：强制刷新两个区域的模型目录；只有已配置 PAT 的区域会成功。
- `/qoder-status`：查看鉴权状态，不显示 PAT。
- `/login qoder` / `/login qoder-global`：首次配置或更换 PAT。
- `/logout`：移除 Pi 中保存的凭据。

示例（已设置国内版环境变量时）：

```bash
pi --model qoder/qfmodel
```

## 实现边界

- Pi 通过原生 `Provider` 调用一个仅监听 `127.0.0.1` 随机端口的进程内网关；每次启动生成随机 Bearer secret，PAT 不发送给 Pi 的模型 API 层。
- 支持流式回答、工具调用、模型声明的思考档位、图片能力标记及 session affinity（用于 prompt cache）。
- 模型目录来自上游；离线/缓存初始化使用原项目的静态兜底目录。刷新失败不会自动清空缓存目录。
- 当前只支持单 PAT/区域，不含 DSH 版的账号池、签到、积分卡片和图形设置页。
- Qoder 的 cosy 协议不是公开稳定 API；上游变更可能使扩展失效。请自行确认账号与服务条款允许这种使用方式。

## 开发验证

在本目录运行：

```bash
pnpm install
pnpm run check
```

## 致谢与许可

协议与目录核心来自 [dsh-connect-qoder](https://github.com/dingminhua/dsh-connect-qoder)（MIT）。本扩展同样采用 MIT 许可。
