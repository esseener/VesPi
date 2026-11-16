# VesPi 1.1.1

**彻底改版：终端优先的 OMP 桌面外壳。** 界面从「聊天面板」收敛为 **设置 + 工作区 + 终端**；Agent 交互发生在终端里的 OMP TUI。

## 破坏性变化

- **主界面是终端**，不是聊天窗。完整能力（工具、子代理、斜杠命令、权限）在 OMP TUI 内。
- GUI 不再是第二套 Agent 界面；按钮尽量驱动同一套 OMP 语义。
- 旧的 rpc-ui 聊天布局、冗余顶栏（路径条 / 终端标题）已移除。

## 本版亮点

### 终端与 TUI
- PTY 直跑 `omp --profile vespi`，ANSI 真彩色、透明底
- **中文显示层**：等宽替换（不撑歪框线）、词边界、Tip 片段汉化
- 直角框线、灰字对比度、字号/行高按 DPI 校准
- 内核更新后自动重启终端并刷新译包

### GUI ↔ OMP 真源
| 动作 | 行为 |
|------|------|
| 新建 / 打开会话 | TUI `/new` · `/resume` |
| 重命名 / 删除 | OMP 会话存储 + `/rename`；删除后 `/new` |
| 模型 / 思考 | 写入 `config.yml` + 注入 TUI |
| OMP 主题 / 符号 / 思考默认 | 设置 → `theme` / `symbolPreset` / `thinking.defaultLevel` |
| Git 传送带 | 本地 `git`，界面标注「不经 agent」 |

### 其它
- 多工作区标签；默认窗口 1200×820
- 捆绑 Laya（Apache-2.0）用于译名决策
- 内核 **OMP 18.3.2**
- README / 截图按新形态重写

## 安装

下载 `VesPi-Setup-1.1.1-win-x64.exe`，覆盖安装即可（保留会话与配置）。

校验：`SHA256SUMS.txt` 随 Release 提供。当前构建未代码签名，SmartScreen 选「更多信息」→「仍要运行」。

## 已知限制

- 中文层是输出流覆盖，不是 OMP 官方 i18n；动态内容（模型名、路径、版本）保留原文
- Tip 轮换句按片段汉化，新句可能仍夹英文
- Git 传送带不经 Agent

## 致谢

- [oh-my-pi](https://github.com/can1357/oh-my-pi) — Agent 内核
- [Laya](https://github.com/NandhaKishorM/laya) — 译名决策（Apache-2.0）
