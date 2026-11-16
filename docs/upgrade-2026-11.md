# VesPi 技术审查与升级（2026-11-15）

## 项目判断

VesPi 是 Windows 优先的 OMP 桌面客户端。当前代码与 desktop/README.md 已转向终端优先：Electron 管理窗口、工作区、设置与更新，node-pty 启动私有 OMP TUI，xterm 显示输出。历史 RPC 会话、审批、工作流与诊断仍在源码中使用。根目录 PROJECT.md / ARCHITECTURE.md 描述的是较早的 RPC 主界面阶段。

适合继续使用 Electron + React + TypeScript + Zustand + Tailwind。原生终端、隔离 preload、Windows 安装器、原生辅助程序及现有 IPC 都已依赖这套技术，当前收益最高的是更新工具链并收敛生命周期，而非重新实现桌面壳或 Agent 执行循环。

## 实时版本核对与选择

版本来自 2026-11-15 查询 npm 官方 registry 的 latest 元数据，以及 GitHub 官方 OMP 最新发布页；“升级前”来自 package-lock.json，而非 package.json 的最低版本范围。

| 组件 | 升级前 | 本次采用 | 判断 |
|---|---|---|---|
| Electron | 43.0.0 | 45.3.2 | 当前稳定版；迁移异步剪贴板 API |
| electron-vite | 3.1.0 | 6.0.0 | 使用 build.externalizeDeps / rolldownOptions |
| Vite | 6.4.3 | 8.3.8 | 升级构建链，与 React 插件 6 配套 |
| React / React DOM | 19.2.7 | 19.3.1 | 同步升级，保持两者一致 |
| Zustand | 5.0.14 | 5.1.0 | 保留现有 store 接口 |
| Tailwind CSS | 4.3.2 | 4.3.5 | 同步升级 Vite 插件 |
| TypeScript | 5.9.3 | 6.0.3 | latest 为 7.0.2，但 typescript-eslint 8.72.2 声明只支持 <6.1 |
| xterm | 5.5.0 | 6.0.0 | fit 0.11、web-links 0.12 配套 |
| node-pty | 1.1.0 | 1.1.0 | registry 当前稳定版；验证 Electron 原生加载 |
| OMP | 18.3.2 | 18.20.2 | 官方 SHA256SUMS 锁定并校验二进制 |
| 开发 Node | 本机 24.14.0，CI 混用 22/24 | 24.14+（24.x） | 开发与发布 CI 统一 |

来源：<https://registry.npmjs.org/>、<https://github.com/can1357/oh-my-pi/releases/latest>。

## 已落实的逻辑优化

- 终端生命周期增加代次检查：异步加载期间收到 stop 或新 start，旧请求不得再创建孤儿 PTY。
- 重启通过 OMP 原生 `--resume <path>` 恢复会话，移除依赖 1.2 秒和 250 毫秒延迟的按键注入；保留最后一次有效终端尺寸。
- 旧 PTY 退出事件不能清空新 PTY 或发送过期退出通知；自然退出和主动停止都释放监听器。
- 渲染端取消未执行的启动计时器；卸载后忽略异步结果；隐藏容器不触发无效尺寸更新。
- 会话切换在合并快速点击、验证主进程切换成功后才驱动 TUI；失败和过期目标不发送 `/resume`。
- 补齐终端 resize / stop / restart 与剪贴板 IPC 的来源校验。
- 删除后台会话不再重新切换当前会话；列表暂时为空时也不覆盖仍在显示的会话。
- 字体资产以本地文件输出，保持 `font-src 'self'`，避免小字体被内联为 data URL 后遭到 CSP 拦截。
- 清理终端主界面中已经不渲染的聊天组件引用、消息分组、建议计算、30 秒刷新与无效状态订阅。
- 应用测试排除 vendor 项目；lint 覆盖应用和维护脚本，临时迁移脚本保留。CI 与本机执行相同测试入口。
- GitHub API 限流时，内核检查只接受同一官方仓库的稳定版 latest 重定向；错误仍按未知处理，下载仍校验官方 SHA-256。

## 后续架构重点

1. **明确 TUI 与 RPC 的会话所有权。** 当前一个终端服务与多 RPC runtime 并存，GUI sessionState 不能完整代表用户在 TUI 内 `/new`、`/resume` 后的状态。应以 OMP 提供的稳定会话事件/元数据建立同步层，再考虑工作区各自保留 PTY。
2. **中文输出层改为有状态流解析。** 当前按任意 PTY chunk 翻译，英文词或 ANSI 转义跨 chunk 时可能失配；应区分控制序列与可见文本，优先推动内核原生 i18n。
3. **拆分大 store 与按需加载面板。** store.ts 承担工作区、会话、更新、预览、设置等职责，主包仍较大。按领域拆分并建立边界测试后，再迁移懒加载；不要以换状态库代替边界梳理。
4. **构建产物与源码分离。** 本地存在大量历史 release 目录及临时迁移脚本，后续可按保留策略归档；本次不清除历史用户文件。
5. **发布门禁覆盖真实 Electron。** 单元测试无法覆盖 ConPTY、剪贴板和窗口生命周期，应将真实桌面 smoke 验证纳入 Windows 打包流程。

具体验证结果与安装交付状态见 desktop/MEMORY.md。框架升级版本为 1.1.11，后续 UI 候选为 1.1.12；公开发布须遵循 AGENTS.md 的本机安装验收要求。

## 验证结果

- `npm run check`：通过；1,424 项测试，1,420 通过、4 跳过、0 失败；包含 TypeScript、ESLint、发布一致性与 Vite 构建。
- `npm run kernel:check`：18.20.2 与官方最新稳定版一致。
- 真实 Electron 45.3.2：preload 可用、node-pty 成功启动 OMP 18.20.2 并产生输出、终端尺寸调整和停止可用、文字与 PNG 截图粘贴通过。
- `npm audit --omit=dev`：0 项已知漏洞。完整开发依赖审计仍有 minimatch / brace-expansion 及上游工具链传递项，未使用强制降级工具解决。
- 本机 MSVC 缺 Spectre 库导致从源码重建 node-pty 失败；node-pty 1.1.0 随包预编译模块已在上述真实 Electron 测试中验证可用。
- 未通过模型付费调用验证完整任务执行；会话恢复参数已通过 OMP `--help` 核对并有服务回归测试。

## 1.1.12 UI 与功能联调

- 统一终端工具栏、按钮尺寸、加载/禁用/错误反馈；搜索作用于真实 xterm 滚动记录。
- 状态栏显示终端进程连接状态；连接不代表模型请求或任务成功。
- 模型菜单去掉重复加载，应用走主进程并向 OMP 传入显式模型参数；错误返回到菜单。配置更新使用完整 YAML 文档，保留注释、列表和嵌套设置，拒绝覆盖无效 YAML。
- 启动期间用户导航优先；终端模式启动时不再同时启动闲置 RPC 内核。
- 翻译增加含 ANSI 颜色码的词边界检查，避免替换英文词内部片段。任意 chunk 跨界翻译仍是后续工作。
- 真实 Electron smoke：新建会话、搜索焦点与无匹配提示、模型菜单、选择模型并在 OMP TUI 看见对应模型、重启保持页面、单次中断输入、清屏、设置入口，以及 1200×820 / 800×600 工具栏边界检查通过。
- 限制：中断测试只证明按键进入终端，未证明长任务取消；未测试付费模型任务、每一个模型、插件安装执行、浏览器/桌面自动化和全量会话恢复。无已知会话路径时使用 OMP 当前目录最近会话，不保证就是 TUI 内切换过的会话。
- Windows smoke 的终端快速关闭期间曾出现 node-pty 辅助进程 `AttachConsole failed`；主终端交互通过，仍需长期运行观察。
- 证据：`work/ui-interaction-result.json`、`work/ui-final-check.log`、`work/ui-production-audit.json` 和 `work/ui-*.png`。
