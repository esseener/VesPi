# Laya（捆绑）— 汉化决策层

仓库: https://github.com/NandhaKishorM/laya

**Laya 不是翻译机**，是「typed decision」引擎（choice / score / yes-no，100+ 语种）。

## 在 VesPi 里的用法

对每条 OMP 英文串，用候选中文让 Laya **choice** 最优译名。

## 安装（本机 / 可打包进安装包）

    python -m pip install "laya[serve]"
    # 或开发版
    python -m pip install "git+https://github.com/NandhaKishorM/laya.git"

## 两种接入

### A. HTTP（laya[serve]）
启动 serve 后，由 `laya-translate.ts` / `laya-i18n.ts` 调用。

### B. CLI 垫片
本目录放置 `laya.cmd`，约定：
- stdin: JSON {"state":"...","choices":["读取文件","读文件"]}
- stdout: {"choice":"读取文件","score":0.9}

## 模型
- convaiinnovations/laya（英文）
- convaiinnovations/laya-multilingual（100+ 语种，含中文）

## 无 Laya
词表+规则仍出中文；有 Laya 则自动在候选里择优。
