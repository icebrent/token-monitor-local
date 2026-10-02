# Codex Usage Dashboard

沿用现有 Electron 透明悬浮窗、tray 和视觉风格，改为剩余额度优先的单页 Usage HUD。
默认展开 450×660（最小 320×480，按屏幕工作区适配），mini mode 为 248×64。
为了兼容已有设置，应用标识和 userData 目录仍保留 `Codex Offline Monitor`。
官方 CLI 会访问 Codex backend，应用不再是完全离线的本地 token 分析器。

## 数据流与安全边界

```text
Renderer → preload IPC → Electron main → codexAppServerClient
         → codex app-server (stdio JSON Lines) → official Codex backend
```

- `usage:getOfficial` 返回当前快照；`usage:refreshOfficial` 请求刷新。
- `account/usage/read` 使用空 params，唯一提供 account token activity；不请求 thread estimate。
- `account/rateLimits/read` 唯一提供额度，优先采用 `rateLimitsByLimitId`，兼容单 bucket。
- 完成 `initialize` / `initialized` 握手后读取 usage。支持 experimental API。
- 仅官方客户端可启动 PATH 上的 Codex native executable；固定 stdio 参数、禁用 shell、隐藏 Windows 窗口。
  支持 Windows npm vendor binary；macOS/Linux 需要 native binary，拒绝 shebang wrapper。
- 不读取、复制、打印或保存凭证、auth.json、access token，也不实现 OAuth；登录和后台网络访问归 CLI。
- renderer 无 spawn、credential、任意路径/命令入口，保留内存 session、严格 CSP、网络取消与权限拒绝。
- 不直接添加 HTTP 客户端、监听端口、同步、更新检查、billing estimate 或额外采集根。
- 旧 `codexJsonlParser.js` 与 localPaths scan/cache helper 只保留于 legacy 测试/debug；生产不扫描
  sessions、不创建 watcher/cache、不导入 parser，没有本地数据 fallback。

## 单页界面与数据口径

- 首屏优先显示 5-hour / Weekly 的 `% LEFT`、官方 `% used` 和相对 reset 时间；进度条表示剩余。
- Today、Month to date、Lifetime 为无边框 stat row，Lifetime 使用 compact number（如 `3.33B`），
  tooltip 显示完整数字。Peak、streak、longest turn、Active Days 为紧凑次级网格。
- Last 28 Days 是 28px 高的 sparkline；六个月 heatmap 保留月份标签，按窗口宽度压缩格子。
  两种图表 hover 显示当天完整 token 数，tooltip 跟随鼠标并避开当前格。
- 不再有 Overview / Activity tabs、逐日长表、独立 Settings 页面或导出入口。
- 工具栏提供 Theme（System → Dark → Light）、Refresh、置顶 pin、设置、mini mode、最小化和隐藏。
  System 跟随系统主题。设置小弹层保留透明度、1/5/15 分钟或 Manual 刷新，默认 5 分钟；
  Status 点击展开 RPC diagnostics，正常主界面只显示 `Official · Updated HH:mm`。
- mini mode 显示 `5h 71% · W 23%`，只显示有数据的窗口；hover 显示 remaining 和 reset，
  点击额度恢复展开窗口，左侧状态点区域可拖动。
- Credits 仅作为条件信息行：零 balance / 零 reset credits 隐藏；有 reset credits、非零 balance、
  Unlimited 或 individual limit 时显示。异常状态才显示警告。

直接值：`summary.lifetimeTokens`、`peakDailyTokens`、`currentStreakDays`、`longestStreakDays`、
`longestRunningTurnSec`，daily bucket 的 `startDate/tokens`，额度 `usedPercent/windowDurationMins/resetsAt`，
`planType`、`normalModelSlug`、Credits、individualLimit、ordinaryUsageAllowed、spendControlReached、
rateLimitReachedType、reset credits availableCount。不会用 daily 合计替代 lifetime，也不会重算官方 streak。

派生值：

- Today：只取本机当前日期完全匹配的 official bucket，没有则隐藏。
- Month to date：仅对当前月第一天到今天的 official buckets 求和，说明为
  `Calculated from official daily activity`。当前月每个日期都有 bucket 才认为完整，否则标注 `partial`；
  没有当前月 bucket 或合计超出 safe integer 范围时隐藏。
- Active Days：与 heatmap 相同的最近六个日历月（本月及前五个月，截止今天），只计 supplied buckets 中
  `tokens > 0` 的天数，并注明范围；不把缺失日期当零 usage。
- Last 28 Days：取截至今天最后 28 个官方 daily buckets，保留 zero-token days，不足 28 个照常展示。
- Remaining：`100 - usedPercent`，限制在 0–100；主指标为 `% LEFT`，官方 `% used` 保留为次级文字。
- turn duration、相对 reset time：格式转换；reset tooltip 显示本机时区的完整时间。

可选数据缺失时隐藏，Lifetime 缺失时也隐藏。heatmap 缺失日期 tooltip 是
`Not provided by official API`，官方零 bucket 为 `No usage`。
Credits balance、individual limit/used 保留官方字符串；当前 schema 没有单位说明，不添加美元/token 单位。
异常 permission、limit reached、spending reached、backend 报告的 credits depleted 仅在发生时显示 warning。
不会仅凭 `hasCredits = false` 就认定异常：未购买 credits 的账号仍可能正常使用包含额度。

未展示：threadUsage（没有请求 threadId，也不使用估算）、accountId（不是 usage 指标）、rateLimitUpsell
（任意 JSON 的促销 banner，无类型化展示契约）、reset credit 逐条 ID/类型/发放/过期/说明（悬浮窗仅展示 availableCount，不提供额度重置操作）。

## 刷新与失败

启动请求、手动 Refresh、按设置自动刷新（默认五分钟，Manual 停止定时 RPC）；窗口重新显示时最后成功 fetch 超过两分钟才刷新。
并发刷新共用 promise。刷新不清空数据；两个 RPC 独立保留最后成功数据与成功时间。
失败显示 `Official data temporarily unavailable` / `Last updated HH:mm`，设置弹层的 diagnostics 列出 endpoint 错误。

`Official · Updated HH:mm` 仅表示客户端最近成功请求官方 RPC 的时间，不是后台入账或数据生成时间。
Tooltip 分别显示 activity/limits 的成功请求时间；快照仅在内存，退出后不持久化。
每分钟只更新相对 reset 文案和本地日期聚合，不额外请求 RPC。

错误区分 CLI missing、start failed、not logged in、endpoint failed、timeout、malformed RPC、unsupported RPC、
process exit。旧 CLI 或当前账号/backend 可能不支持 experimental usage；此时没有 parser fallback。
JSON bigint 超出 JavaScript safe integer 范围时拒绝显示，避免静默舍入。

## 本地运行与验证

需要 Node.js 22.13+、已安装官方 Codex CLI，且已在正常终端使用 CLI 登录目标账号。
不需要向本应用提供 API key 或 token。

```powershell
npm.cmd ci
npm.cmd start
npm.cmd run verify
npm.cmd run pack
```

协议字段来源：当前生产 resolver 在 PATH 上找到的本机 `codex-cli 0.154.0`，通过
`codex app-server generate-ts --experimental --out <temporary-directory>` 重新生成。
原始相关类型见 `docs/protocol/`，这些是参考摘录，不是可独立编译的 TypeScript 包。

对照同一账号的 Codex Settings usage 时，比较 lifetime、peak、streak、daily 日期/tokens、Plan、
各额度 usage/reset。统计延迟、账号/工作区、CLI 版本和日期边界可能造成差异。
Mock 测试不证明真实账号值与 Settings 一致；真实验收需要两个 RPC 成功。

## 本地文件与验证

仅写入 Electron userData 的 settings/Chromium 运行状态。快照在内存，不持久化官方 usage。
已移除导出模块、相关 IPC 和 `shell.openPath` 能力，不会删除用户以前生成的导出文件。
旧 settings 中 exportDir 不再使用；主题、透明度、置顶继续兼容，新刷新间隔缺失时默认 300 秒。
不会保存 RPC 原始 payload 或 stderr；debug stderr 仅报告事件。

`npm run verify` 执行 ESLint 与全部 node:test，包括保留的 legacy parser、文件/网络边界、
官方握手/RPC 生命周期、映射、刷新/失败保留、聚合日期边界、remaining HUD、主题/置顶/刷新控制、
条件 credits、精确 tooltip 与旧 UI/IPC 移除检查。没有增加依赖；chokidar 依赖仍保留，生产不使用。
