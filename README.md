# Codex Offline Monitor

这是一个仅供个人使用的纯本地离线 Electron 应用。它只读取本机 Codex
JSONL 会话日志，显示今天、本月、全部、模型、会话和每日趋势，并提供透明悬浮窗、
系统托盘及本地 JSON/CSV 导出。

本 fork 不包含云端服务、账号体系、多设备同步、provider limits、自动更新、
Discord Rich Presence、汇率、服务状态查询或其他 AI 工具采集器。

## 本地文件边界

应用启动时仅解析一次固定扫描根：

```text
${CODEX_HOME:-~/.codex}/sessions/**/*.jsonl
```

`CODEX_HOME` 和 `sessions` 会在主进程启动时 canonicalize。扫描器只跟随固定根目录
内的真实普通 JSONL 文件，拒绝 UNC/网络路径，忽略符号链接和 Windows junction，
renderer 不能传入或修改扫描根。应用不会读取 `.codex/auth.json`、`.codex/config.toml`
或项目目录内容；日志内已有的 `cwd` 仅取最后一级名称用于本地会话标签。

应用可写入：

| 位置 | 内容 |
| --- | --- |
| Electron `userData` 下的 `Codex Offline Monitor` 目录 | 应用的 `settings.json`（仅含窗口、主题、透明度和已选择的导出目录），以及 Electron/Chromium 自身可能创建的本地 Preferences、GPU/代码缓存等运行状态 |
| 用户通过系统目录选择器明确选定的本地目录 | `codex-offline-usage.json`、`codex-offline-models.csv`、`codex-offline-daily.csv` |

常见 `userData` 位置：

- Windows：`%APPDATA%\Codex Offline Monitor`
- macOS：`~/Library/Application Support/Codex Offline Monitor`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/Codex Offline Monitor`

`shell.openPath` 只可打开当前 `userData`、用户明确选定且已固定的导出目录，以及本次
运行刚生成的三个导出文件。renderer 没有任意路径参数。

renderer 使用不带 `persist:` 前缀的内存 session，且禁用该 session 的缓存；应用不会
把 cookie、认证 token 或网页存储作为业务数据写入磁盘。Electron 仍可能在
`userData` 根下维护其自身的通用本地状态，因此整个专用 `userData` 目录都应视为
应用可写范围。

## 明确不执行的行为

应用运行时：

- 不发起 HTTP、HTTPS、WebSocket 或 Secure WebSocket 请求；
- 不创建 HTTP、TCP、UDP、SSE 或其他网络监听端口；
- 不上传设备、项目、模型、会话、token、费用或账号信息；
- 不读取、保存或迁移 API key、cookie、access token、refresh token、
  `credentials.json` 或 Codex 认证文件；
- 应用代码不调用 `child_process`，不启动 tokscale、npm、WSL、OAuth helper
  或其他外部 CLI；Electron 自身仍会按其架构创建 renderer、GPU/utility 子进程；
- 不加载原生 Node addon；
- 不调用 `shell.openExternal`，不允许新窗口、webview 或不受控导航；
- 不检查 GitHub Releases、价格源、汇率、服务状态或 provider API。

Electron 同时使用 `webRequest` 取消四种网络协议，并通过严格 CSP 设置
`connect-src 'none'`。这些是防回归措施，不是对原生模块或子进程的完整沙箱；
离线保证来自相关网络代码、CLI、OAuth、同步、更新模块和依赖的物理删除。

## 统计语义

自制解析器优先对 Codex `total_token_usage` 累计快照做差，使用
`last_token_usage` 仅兼容缺少累计字段的旧日志。缓存输入是输入的子集，推理 token
是输出的子集，不会重复加总。session 跨日和跨月时，各 token 增量按事件发生时的
本机日历归属。

完整规则见 [Codex 日志统计语义](docs/codex-log-semantics.md)。删除 tokscale 前，
解析器在 210 个真实 session 上完成对照：today 与 month 的 token 分类、模型和
session 全部精确一致；all-time 仅一个旧 session 因 Codex 累计值与
`last_token_usage` 之和不同而保留 61,305 token 的有依据差异。详见
[真实日志交叉验证](docs/codex-parser-cross-validation.md)。

## 构建与验证

需要 Node.js 22.13 或更高版本。安装依赖和构建本身可能访问 npm；构建出的应用运行时
不需要网络。

```bash
npm ci
npm run verify
npm run pack
```

`npm run verify` 执行 ESLint 和 `node:test`，覆盖：

- 固定 Codex 根目录及 Windows junction、符号链接、UNC、`..` 和大小写边界；
- 累计 token 语义、重复事件、未知事件/模型、跨日/跨月归属；
- 日志追加、截断、重写和删除后的缓存行为；
- JSON/CSV 本地导出；
- HTTP/HTTPS/WS/WSS 拦截、严格 CSP、权限/导航/新窗口拒绝；
- runtime 源码不存在监听、子进程、原生 addon、同步、provider 或凭证入口。

打包目录输出到 `dist/`。可进一步对 `dist/` 做依赖和字符串审计；策略文件中会保留
用于拒绝请求的四种协议名称和 CSP 指令，这是预期的安全策略证据。
