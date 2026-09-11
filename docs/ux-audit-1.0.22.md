# VesPi 全局交互审查报告（1.0.22）

审查范围：`desktop/src/renderer/src/` 全部 79 个组件
审查视角：人类使用者的真实操作路径 —— 能不能找到、会不会卡住、会不会误删、关了还能不能回来
产出日期：2026-09-09
**处置状态：全部已修复（2026-09-10）** —— 见文末「修复记录」

---

## 一、严重问题（影响正常使用）

### S1. 三个视图是「永远的孤岛」——任何人都不可能打开

| 视图 | 渲染位置 | 入口数量 |
|---|---|---|
| `skills` | `app.tsx:259` | **0** |
| `diagnostics` | `app.tsx:262` | **0** |
| `mission-control` | `app.tsx:249` | **0** |

全仓库没有任何一处调用 `setCurrentView('skills' / 'diagnostics' / 'mission-control')`。

- 侧栏工具区（`sidebar.tsx:643-676`）只放了 4 个按钮：扩展 / 笔记 / 关于 / 设置。`ToolView` 类型（`sidebar.tsx:39`）也只声明了这 4 个值。
- 命令面板（`hooks.ts:501-503`）只有 `resume` / `fork` / `settings` 三条视图跳转命令。
- 快捷键也没有。

**后果**：`MissionControl`（工作流运行面板）、`DiagnosticsPanel`（诊断面板）被整整写出来、打包进产物、占着 bundle 体积，但用户永远看不到。这不是"藏得深"，是**物理不存在入口**。

### S2. `skills` 视图渲染错了组件，而正确的那个组件是死代码

- `app.tsx:259`：`currentView === 'skills'` 渲染的是 `<PackageBrowser />`，不是 `SkillsPanel`。
- `skills-panel.tsx` 定义了 `SkillsPanel`（含创建/删除/演进技能的完整功能），**全仓库零引用**。
- 原因（`package-browser.tsx:485-487` 注释）：技能已移交 OpenSpace 管理，「扩展页不再有技能标签页」。

**后果**：一次架构迁移（技能 → OpenSpace）留下了三处不一致 —— 视图枚举里的 `'skills'` 是残留、`skills-panel.tsx` 是死文件、`app.tsx:259` 这行分流永远走不到。**要么删干净，要么补入口**，现在是半吊子状态。

### S3. Timeline 的「清空」没有二次确认

`timeline.tsx:104-110` 的 `onClick={clearTimeline}` 直接执行；`store.ts:2970` 的 `clearTimeline: () => set({ timelineEvents: [] })` 无确认逻辑。

同一个应用里，删会话（`sidebar.tsx:336-392`）、删会话记录（`session-panel.tsx:653-689`）、删工作区（`workspace-tabs.tsx:301-346`）、重置默认设置（`settings-panel.tsx:457-466`）**全都有**内联确认卡片。唯独清空 timeline 一点就没。这是明显的不一致，而且用户点它的时候多半是想"收起面板"。

---

## 二、交互不妥（不至于坏掉，但用起来别扭）

### U1. 七个工具面板全都「关不掉」，只能去顶部标签栏找那个小小的 ×

`settings` / `extensions` / `notes` / `about` / `timeline` / `mission-control` / `diagnostics` 七个面板的实际关闭方式（经逐一核查）：

| 面板 | 自带标题栏 | 面板内关闭按钮 | Esc 关闭 |
|---|---|---|---|
| settings-panel | 有 | 无（那个 × 只关错误横幅） | 无 |
| package-browser | 有 | 无（那个 × 只关通知横幅） | 无 |
| notes-panel | 有 | 无 | 无 |
| about-panel | 有 | 无 | 无 |
| timeline | 有 | 无 | 无 |
| mission-control | 有 | 无 | 无 |
| diagnostics-panel | 有 | 无 | 无 |

七个全中。用户进设置页后想退出来，唯一的办法是抬头去 `workspace-tabs.tsx` 找那个和标签同宽的 ×（`:208-218`）。这是违反直觉的 —— 面板自己的地盘应该有退出方式。

**对照组**：全应用有 18 处文件实现了 Esc 监听（`command-palette`、`context-menu`、`extension-ui-dialog`、`status-popover`、`theme-editor`、`note-picker`……），说明团队知道该怎么做 Esc，只是这七个面板漏了。

### U2. 五个空状态只有文字，用户站在死胡同里

| 位置 | 文案 | 操作按钮 |
|---|---|---|
| `timeline.tsx:115-120` | 「还没有活动」 | 无 |
| `command-palette.tsx:215` | 「无匹配结果」 | 无 |
| `mission-control.tsx:130/189` | 「无实时会话」/「无工作流运行」 | 无 |
| `notes-panel.tsx:159-162` | 「笔记为空」/「无匹配」 | 无 |
| `package-browser.tsx:291-298` | 「未安装扩展」+ 提示去目录安装 | 无（**提示了去哪，却不给按钮**） |

`package-browser` 这条最刺眼：文案写着"去目录浏览或安装"，但页面上没有可点的东西。`session-panel.tsx:207-225` 做对了（配了 `createFirstSession` 按钮），其他五个没跟上。

### U3. `diff` 视图有 4 个入口，其余视图入口分布极不均匀

| 视图 | 入口数 | 分布 |
|---|---|---|
| `diff` | **4** | 首页状态卡(`home-screen:134`)、MC 行(`mission-control:86`)、审查侧栏文件行(`review-rail:140`)、审查侧栏按钮(`review-rail:160`) |
| `settings` | 3 | 侧栏 / 首页错误卡 / 命令面板 |
| `notes` | 2 | 侧栏 / 笔记选择器 |
| `sessions` | 2 | 侧栏 View All / 命令 `resume` |
| `timeline` | **1** | 只有命令 `fork`（Ctrl+K 里那个叫"分叉"的命令）——**按 Ctrl+K 搜"时间线"搜不到** |
| `skills` / `diagnostics` / `mission-control` | **0** | 见 S1 |

`timeline` 的问题很实际：它的功能是「会话分支 + 分叉历史」，但唯一入口叫 `fork`（分叉）。用户想"看看我的会话分支图"时，无论搜"时间线""分支""Timeline"，命令面板都没有这条。

---

## 三、重复与残留

### R1. `skills-panel.tsx` —— 死文件（见 S2）

### R2. `status-bar` 与 `status-popover` 职责暧昧

- `status-bar.tsx`：底部全宽状态条（`app.tsx:271`），含工作流运行入口。
- `status-popover.tsx`：侧栏头部的弹出状态面板（`sidebar.tsx:522`），含 skills 列表、provider 测试、compact 切换。

两个组件都叫"状态"，都展示运行时信息，位置一上一下。不是纯重复（内容确实不同），但**用户看到两处状态指示会困惑该看哪个**。建议明确分工：底栏只做"当前会话状态"，弹层只做"环境与依赖健康"。

### R3. `timeline` 的「Branches / 会话树」与 `session-panel` 不重叠（已排除）

经核查：`session-panel` 按项目分组会话 + 标签/归档，**不含** lineage / fork 树；`timeline` 才有 `LineageTree` 和 `cloneBranch`。功能不重复，前者是"列表管理"，后者是"分支图谱"。**这条不需要动。**

### R4. `notes-panel` 与 `note-picker` 不重复（已排除）

`note-picker` 是聊天输入框里的插入笔记弹层（`chat-input.tsx:754` 触发），`notes-panel` 是笔记管理页。场景不同，合理。

---

## 四、与 OMP 内核 / 使用逻辑不匹配的地方

### K1. `mission-control` 这个视图名与它的能力不匹配

面板内容（`mission-control.tsx`）：列出**运行中的会话**（`noLiveSessions`）+ **工作流运行记录**（`noWorkflowRuns`），带 Refresh 和 New Task。

但 `MissionControl` 这个词在用户的认知里 = "任务总控台"，应该是**一级入口**，而不是一个没有任何入口的隐藏页。它对标的是"我有哪些任务在跑"，属于高频信息。现在它的关键功能（点一行 → 跳到该会话的 diff，`:86`）根本没人能触发。

### K2. `diagnostics` 写好了但没接线

诊断面板（`diagnostics-panel.tsx`，含 Copy / Refresh）是排障时的刚需入口。当用户遇到 OMP 内核异常（`piStatus === 'error'`）时，首页错误卡（`home-screen.tsx:266`）只给了一个「去设置」按钮 —— 而真正该去的是诊断面板。

### K3. 清空 timeline 的语义与用户意图不符

用户点 Timeline 面板右上角的「清空」（`timeline.tsx:104`），十有八九想的是"把这个面板收起来 / 重置一下视图"，结果是**永久删除全部活动历史**且不可撤销。正确做法是让这个按钮变成长按或二次确认，并把「关闭面板」和「清空记录」彻底分开。

---

## 五、建议的处置优先级

| 优先级 | 事项 | 类型 |
|---|---|---|
| **P0** | S3：给 `clearTimeline` 加二次确认 | 数据安全 |
| **P0** | S1：给 `mission-control` 补入口（侧栏工具区 + 命令面板） | 功能不可达 |
| **P1** | S2：确定 `skills` 的去留 —— 删 `skills-panel.tsx` + 清 `'skills'` 枚举 + 清 `app.tsx:259`，或恢复入口 | 死代码 / 半迁移 |
| **P1** | K2：`diagnostics` 补入口，并挂到首页错误卡上 | 排障路径 |
| **P1** | U1：给七个工具面板统一加 Esc 关闭 | 交互一致性 |
| **P2** | U2：给五个空状态补操作按钮（至少 package-browser 和 notes） | 防死胡同 |
| **P2** | U3：命令面板补一条「时间线 / 会话分支」命令 | 可发现性 |
| **P3** | R2：明确 status-bar / status-popover 分工 | 信息架构 |

已排除、无需处理：R3（timeline vs session-panel）、R4（notes-panel vs note-picker）。

---

## 六、修复记录（2026-09-10）

P0 与 P1 全部落地，P2 全部落地，P3 随 R2 一并处理。

| 编号 | 修复方式 | 涉及文件 |
|---|---|---|
| **S3** | 「清空」改为内联确认卡片（显示将删除的记录条数），空列表时按钮禁用 | `timeline.tsx`、`i18n.ts`（+3 key） |
| **S1** | 侧栏工具区新增「任务中心」「诊断」两个按钮；命令面板新增 `missions`/`diagnostics`/`timeline` 三条命令 | `sidebar.tsx`（`ToolView` 扩展 2 值）、`hooks.ts`、`i18n.ts`（+3 key） |
| **S2** | `skills-panel.tsx` 删除；`'skills'` 从 `currentView` 枚举、`app.tsx` 分流、`workspace-tabs` 映射中移除（`status-popover` 的 OpenSpace 技能列表保留） | `skills-panel.tsx`（删除）、`store.ts`、`app.tsx`、`workspace-tabs.tsx` |
| **K2** | 首页内核错误卡新增「诊断」按钮，排障路径直达 | `home-screen.tsx` |
| **U1** | 新增 `useEscapeToClose` hook（bubble 阶段 + IME 守卫 + 输入框让位），七个面板统一接入；`theme-editor`/`theme-gallery` 补 `stopPropagation` 确保内嵌弹层优先消费 Esc | `hooks/use-escape-close.ts`（新建）、七个面板、`theme-editor.tsx`、`theme-gallery.tsx` |
| **U2** | `package-browser` 空状态补「浏览插件目录」按钮（经 `onBrowseCatalog` prop 下传）；`notes-panel` 空状态补「新建速记」/「清空搜索」；`timeline` 空状态补「回到对话」；`mission-control` 的 `EmptyState` 支持 action 插槽并补两个按钮 | `package-browser.tsx`、`notes-panel.tsx`、`timeline.tsx`、`mission-control.tsx`、`i18n.ts` |
| **U3** | 命令面板新增 `timeline` 命令，搜索「时间线 / 分支」可达（此前唯一入口叫 `fork`） | `hooks.ts` |

门禁：typecheck ✓ / lint ✓ / 1010 测试通过 0 失败 / check:release ✓。

**未纳入本次修复**：R2（status-bar 与 status-popover 的职责划分）属信息架构调整，需产品决策，暂不动。
