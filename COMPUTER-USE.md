# VesPi 的 computer use：实现说明

> 状态：**已实施**（2026-09-21）。原调研稿 `COMPUTER-USE-PLAN.md` 已被本文取代。
> 放在仓库根而非 `docs/`，因为 `docs/` 是 GitHub Pages 的发布源，会对外公开。

---

## 一、一句话说清

模型现在有第三个工具集：`computer_*`。它能移动用户的鼠标、用键盘输入、点击任意窗口，也能读取窗口的可访问性树。**随安装包自带**（安装包里多一个 265 KB 的 exe，不需要用户另外装任何东西），**默认关闭**，且**纯文本模型也能真正使用**（不是只给视觉模型摆样子）。

---

## 二、三个设计决定，以及为什么

### 1. 为什么是一个 Rust 独立进程，而不是 Node 原生模块

Electron 主进程**没有**任何 API 能做这些事：没有「在屏幕坐标 (x, y) 注入一次点击」，也没有「读另一个应用的可访问性树」。所以这些能力必须由原生代码提供。

原生能力有两条路：Node 原生模块（addon）或独立进程（sidecar）。选了后者：

- **没有 ABI 约束**。原生模块必须针对特定的 Electron/Node ABI 编译，每次升 Electron 都要重编；独立 exe 只要会读写 stdin 就行。
- **不需要 Rust 之外的任何工具链**。编出来的 exe 是 265 KB，直接塞进安装包。
- 崩溃隔离：sidecar 挂了不会带走主进程，下次调用自动重启一个新的（`computer-sidecar.ts` 里有测试覆盖）。

代码在 `native-cua/`，用 `windows` crate 直接调 Win32 与 UIAutomation。

### 2. 为什么纯文本模型也能用

computer use 的常见做法是「截图丢给模型，模型吐坐标」。这条路对**不看图的模型直接失效** —— 而 VesPi 的模型来自 `models.yml`，用户完全可能只配了文本模型。

所以主路径是**文本**：

| 模型能力 | 走的路 |
|---|---|
| 能看图 | `computer_capture` 截图 → 换算坐标 → `computer_click` |
| 不看图 | `computer_uitree` 读具名控件（按钮/输入框/列表项，带 id 与位置）→ `computer_invoke` 按 id 操作 |

`computer_uitree` 是这个功能能对所有模型成立的关键。它返回的是人能读懂的行，例如：

```
#3 text "9 个项目" @2381,988
#12 treeitem "下载 (已固定)" @2422,437
```

另外 `computer_invoke` 会优先使用控件自身的可访问性动作（UIA Invoke pattern）—— 这在后台窗口上也有效，而且**不会抢用户的鼠标**；只有在控件没有可访问性动作时才回退到坐标点击。

### 3. 为什么默认关闭，而浏览器默认开启

浏览器是 VesPi 自己造的沙箱：独立 profile、无用户登录、只允许 http(s)。桌面是用户的真实机器 —— 他的邮件、文件、银行页面。默认打开等于替他做了一个他看不见的决定，所以 `agentComputerEnabled` 只有在**显式设为 true** 时才生效（`computer-mcp.ts` 有测试钉死这一点）。

---

## 三、链路

```
模型
 └─ mcp__computer__computer_uitree …          ← 工具名由 MCP 服务器命名空间化
     └─ resources/vespi-computer-mcp.mjs      ← 零依赖 stdio MCP 桥（含 instructions）
         └─ \\.\pipe\vespi-computer-<rand>    ← 命名管道 + 每次启动的随机 token
             └─ src/main/computer-channel.ts  ← 管道上的 HTTP 服务端
                 └─ src/main/computer-ops.ts  ← 权限、白名单、限额（策略都在这一层）
                     └─ src/main/computer-sidecar.ts  ← 懒启动、JSONL 请求/响应配对、超时
                         └─ resources/vespi-cua.exe   ← Win32 / UIA 实际干活
```

注册点是 `~/.omp/profiles/VesPi/agent/mcp.json` 里的 `mcpServers.computer`，与 `browser`、`panel` 两个 server 并列。

**sidecar 是懒启动的**：不打开这个功能不会多出任何进程；打开但没人调用工具时，也不会启动 helper。第一次工具调用才 spawn。

### 安全设计（都在 `computer-ops.ts`，有单元测试）

- **永不操作 VesPi 自身**。harness 文档里对模型的禁令，在这里被真正执行：`windows` 列表里 VesPi 自己的行标 `actionable: false`，`focus`/`capture`/`uitree`/`invoke` 直接拒绝。
- **应用白名单**（`agentComputerApps`）：非空时是硬边界，窗口进程不在名单里就拒绝 —— 包括**输入类操作**，因为它们打给「当前焦点窗口」，所以点之前会先查焦点是谁。
- **一切有上限**：元素数 800、输入文本 8000 字符、截图长边 1568、请求体 256 KB。
- **坐标必须落在桌面范围内**，并且是按**整个虚拟桌面**（多显示器）判断，不是主屏。
- **传输面最小**：命名管道（网络上不可达、没有端口可扫）+ 每次启动随机 token，只通过环境变量交给 VesPi 自己 spawn 的子进程。

---

## 四、文件清单

### 新增

| 文件 | 作用 |
|---|---|
| `native-cua/`（Rust crate） | sidecar 源码：窗口枚举、可访问性树、截图、输入注入 |
| `resources/vespi-computer-mcp.mjs` | stdio MCP 桥，含给模型的 `instructions` |
| `src/main/computer-sidecar.ts` | 进程管理、JSONL 协议、超时与重启 |
| `src/main/computer-channel.ts` | 命名管道 + token 的传输层 |
| `src/main/computer-ops.ts` | op 表、白名单、限额（策略层） |
| `src/main/computer-mcp.ts` | MCP entry、设置读取、路径解析 |
| `scripts/build-cua.mjs` | 构建 sidecar 并 stage 到 `resources/` |
| `src/main/computer-{sidecar,ops,mcp}.test.ts` | 46 个单元测试 |

### 改动

| 文件 | 改动 |
|---|---|
| `src/main/index.ts` | 读取设置、起通道、写/摘 mcp.json entry、退出时清理 |
| `resources/vespi-harness.md` | 新增 "Desktop control" 段（模型侧的规则） |
| `resources/permission-rules.ts` | 门控匹配改为前缀感知：`mcp__computer__computer_uitree` 这类名字以前会绕过门控 |
| `src/shared/default-settings.ts` · `ipc-contracts.ts` · `i18n.ts` · `settings-panel.tsx` | 新开关（默认关）+ 中英文文案 |
| `package.json` · `.gitignore` | `build:cua` 脚本；sidecar 产物不入库 |
| `.github/workflows/build.yml` | verify 阶段 `cargo check`；build 阶段构建并 stage；打包后断言 helper 与桥都在包里 |

`resources/` 整目录已是 `extraResources`，所以新文件自动进包，无需改打包配置。新增的 `assert` 断言是为了防止「功能悄悄不在包里」——这正是这个仓库既有的做法。

---

## 五、端到端验证（已做）

不依赖 Electron，用真实的管道把全链路跑通（MCP 客户端 → 桥 → 通道 → ops → sidecar → 真实桌面）：

```
initialize        -> serverInfo=vespi-computer, instructions=1334 chars
tools/list        -> 10 个工具
computer_windows  -> 20 个窗口（真实桌面）
computer_uitree   -> explorer 的 12 个具名控件（含中文名与坐标）
computer_capture  -> content=[image+text]，文本含 origin/scale 换算说明
computer_screen   -> 2 个显示器，桌面 3840x1080
白名单探针        -> isError=true，明确说 wetype_update.exe 不在名单
未知工具探针      -> isError=true
```

另外：`cargo check` 通过、`npm run typecheck` 通过、`npm run lint` 通过、全量 `npm test` 1333 项 0 失败。

**顺带修掉一个真实缺陷**：这台机器是双显示器（桌面 3840×1080，主屏 1920×1080）。最初的实现按主屏归一化鼠标坐标、按主屏截屏 —— 副屏上的窗口会点错位置、截错区域。现在坐标按整个虚拟桌面归一化并带 `MOUSEEVENTF_VIRTUALDESK`，截屏也覆盖整个桌面。

---

## 六、已知限制 / 下一步

- **白名单目前只能改配置文件**（`settings.json` 里的 `agentComputerApps`，进程名数组）。设置面板只有开关，还没有名单编辑器。
- **可访问性树是扁平化的**，没有层级，也没读控件的值（只读名字与位置）。对绝大多数表单足够，对复杂表格/树可能不够精准。
- **截图走 GDI 合成桌面**（所见即所点），因此**被遮挡的窗口截不到**。Codex 用的是 `Windows.Graphics.Capture`，能截被遮挡的窗口，代价是复杂度高得多。当前取舍是「截图 = 用户看到的」。
- **没有 UIA 的 ValuePattern**，即不能直接读输入框里的文字（可以读 UIA name，某些控件会把值放进 name）。
- 剪贴板、拖拽尚未实现；`computer_click` 支持左/右/中与双击，没有拖拽。

下一步优先级建议：① 白名单 UI；② 读控件值（ValuePattern）；③ 拖拽。
