# Trae 与 WorkBuddy 企业专享版验证记录

本记录用于区分源码能力与实际账号验证结果。基线为 `68d0a4e4bfd8dc5a1daa296c61e0cc0b10a871da`；项目原有许可和使用声明见仓库根目录 `LICENSE`。

## 当前状态

| 项目 | 状态 | 依据或阻碍 |
| --- | --- | --- |
| Trae 模型目录、对话、流式输出和工具调用 | PASS | 账号登录并刷新目录后，使用 `Doubao-Seed-2.1-Turbo-solo` 完成真实调用；其他目录模型未逐一推理验证。 |
| WorkBuddy 国内公开版模型目录、对话、流式输出和工具调用 | PASS | 使用已登录的公开版账号和 `hy3` 完成真实调用；不得据此认定企业专享版可用。 |
| WorkBuddy 企业专享版连接 | BLOCKED | 企业登录页面的不带凭据请求返回 HTTP 200；尚未确认或验证模型 API 地址。 |
| WorkBuddy 企业专享版认证 | BLOCKED | 尚未确认企业允许的第三方认证流程和调用授权。 |
| WorkBuddy 企业专享版模型目录及推理 | BLOCKED | 尚未取得正式接口协议、账号授权和真实调用结果。 |

现有 WorkBuddy 代码区分国内版和国际版，并支持账号级 Endpoint；这些实现不能证明企业专享版采用相同协议。Trae 代码中的模型目录和流式处理也不能证明特定账号有模型权限。不要将其他提供商或自动回退产生的响应记作目标提供商成功。

2026-10-29 的本机验证：安装 MSVC 和 Windows SDK 后，网关 `cargo check --locked -p agent2api-server` 通过；现有测试 585 项通过、6 项忽略、0 项失败。隔离网关监听本机回环地址，`/health` 返回 HTTP 200，未添加账号时 `/v1/models` 返回空列表。创建临时 Key 后，无 Key 和错误 Key 均返回 HTTP 401；正确 Key 的请求进入选路，但由于没有可用账号仍返回 HTTP 401。重启后正确 Key 请求也返回 HTTP 401，尚需区分鉴权和上游错误以完整确认重启后的 Key 行为。以上均不代表真实模型调用成功。

登录页面返回 HTTP 200 只证明该页面可访问，不证明企业身份、接口权限或模型调用可用。

腾讯公开的 [WorkBuddy Managed Agents API 文档](https://cloud.tencent.com/document/api/1831/138581) 描述了企业托管智能体的 REST API，要求签名和 CAM 鉴权；[WorkBuddy 开放平台文档](https://open.workbuddy.cn/docs/openapi) 描述了第三方应用的 OAuth 2.1、云端任务与本地助理接口。它们提供了可向企业管理员核实的正式接入方向，但尚无证据证明当前企业专享实例开通这些能力，或提供等价于直接模型推理的接口，不能将文档中的其他产品能力视为本实例已经授权。

腾讯的 [CodeBuddy 安装和登录文档](https://cloud.tencent.com/document/product/1831/137000) 描述了企业域名登录，适用于专享版或私有化部署；[身份和访问管理文档](https://cloud.tencent.com/document/product/1831/137057) 描述专享环境及企业地址设置。已在 `.verify` 下隔离安装官方命令行工具 2.178.1 和 Agent SDK 0.3.294，用于验证正式登录路径；这不证明它们与当前企业专享实例兼容。该工具的一个依赖声明需要 Node.js 22 或更高，已下载并校验 Node.js 22.23.4 便携版；首次登录窗口使用原有的 Node.js 20.20.2，尚待验证完整兼容性。企业客户端显示名为 WorkBuddy-donghua，检测到的产品版本为 5.3.11.0。

桌面端 `cargo build --locked -p workbuddy-proxy-desktop` 已通过；暂停时尚未启动桌面端验证界面及账号登录。

2026-10-30 已启动桌面开发应用，开发模式网关监听 `127.0.0.1:3066`；未添加账号时健康接口显示降级。隔离实例中创建临时 Key 后，受保护管理接口对无 Key 和错误 Key 返回 HTTP 401，对有效 Key 返回 HTTP 200；实例重启后，以环境变量配置的临时 Key 访问管理接口也返回 HTTP 200。

修复后桌面开发应用已重新构建和启动，重启后目录仍列出 18 个 Trae 模型，包含已验证模型。`/health` 返回 HTTP 200、状态 `degraded`；默认 WorkBuddy 单账号未配置，因此不能将该状态当作所有提供商健康的证据。

Trae 网页登录后，重启实例并强制刷新目录，返回 18 个标记为 Trae 的模型。使用 `Doubao-Seed-2.1-Turbo-solo` 的真实普通对话返回 HTTP 200 和 `OK`，流式响应返回 HTTP 200 并包含结束帧；日志显示均由 Trae 直连处理，每次尝试一次。真实工具请求最初返回工具调用但结束标记为 `stop`；修复后非流式和流式请求均返回 HTTP 200、工具名 `get_time` 和结束标记 `tool_calls`，流式响应包含结束帧，日志确认均由 Trae 处理且各尝试一次。另以固定测试值 `09:00` 作为工具结果回传，模型返回相同时间，验证了两轮消息闭环；这不是实际时钟查询。完整网关测试为 586 项通过、6 项忽略、0 项失败；测试不替代真实调用。

2026-10-30 使用 WorkBuddy 国内公开版账号刷新目录，网关返回 `hy3` 和 `deepseek-v4.1-flash` 两个来源标记为 WorkBuddy 的模型。对 `hy3` 的真实普通对话返回 `OK`，流式对话返回 `OK` 和结束帧，工具请求返回 `get_time` 和 `tool_calls` 结束标记；日志显示三次均由 WorkBuddy 直连处理且各尝试一次。`deepseek-v4.1-flash` 未单独进行推理验证；本段结果不适用于企业专享版。

## 本机开发及客户端接入

本次隔离数据目录为项目下 `.verify/desktop-data`，已由 `.gitignore` 排除；其中包含账号数据，不得复制进仓库或分享。开发模式默认地址为 `http://127.0.0.1:3066/v1`；发布版默认端口为 3065，实际地址以应用显示和监听结果为准。在应用的「网关 Key」页面创建供客户端使用的 Key，避免使用本次仅用于验证的临时 Key。DSH 可填写上述地址、自己的网关 Key 和已验证模型 `Doubao-Seed-2.1-Turbo-solo`。

在仓库根目录的 PowerShell 中，可使用已隔离安装的工具链启动开发应用：

```powershell
$env:RUSTUP_HOME = Join-Path (Get-Location) '.verify\rustup'
$env:CARGO_HOME = Join-Path (Get-Location) '.verify\cargo'
$env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
$env:AGENT2API_PROXY_HOME = Join-Path (Get-Location) '.verify\desktop-data'
npm run tauri:dev
```

在另一个 PowerShell 会话中，将自己创建的网关 Key 置于环境变量 `AGENT2API_KEY` 后，可用以下请求验证；不要把真实 Key 写进脚本或仓库：

```powershell
$headers = @{ Authorization = "Bearer $env:AGENT2API_KEY" }
$body = @{ model = 'Doubao-Seed-2.1-Turbo-solo'; messages = @(@{ role = 'user'; content = '请回复 OK' }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod 'http://127.0.0.1:3066/v1/chat/completions' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

## 继续验证所需条件

1. 完成桌面窗口可见性、重启和账号登录验证；按仓库实际要求使用 Rust 1.88 或更高版本。
2. 获取企业管理员或厂商提供的第三方模型 API 地址、接口文档、认证方式及调用授权。不要在仓库中记录企业地址、账号凭据或内部资料。
3. 在隔离的数据目录中启动网关，限制监听地址为本机；使用应用提供的授权流程，并确认测试内容和额度使用符合账号权限。
4. 分别记录目标账号的连接、认证、模型目录、普通对话、流式输出、适用的工具调用、错误处理、来源及可用时的额度结果。记录脱敏证据，禁止把 Token、Cookie、密码和请求中的敏感信息写入仓库。
5. 回归测试通过后更新本记录；模拟结果和静态源码检查不能替代真实调用。

上游说明凭据可能以明文保存在本机数据库中；运行数据和导出文件不得提交。项目声明为非官方客户端，并对用途作出限制，使用前应核对 `LICENSE` 和相关服务授权。
