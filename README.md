# dsh-LorebookMD — DSH 世界书驱动的小说创作插件

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件：导入酒馆（SillyTavern/TavernAI）角色卡与世界书，落地为**本地 Markdown 设定文档**，激活创作模式后**根据用户输入、参考世界书创作小说**。

> 说明：本插件只管理你自己提供的设定文本；工程内不内置任何"破限/越狱"提示词内容。

## 功能

- **导入**：角色卡（PNG 内嵌 / JSON）与独立世界书（`{ entries: [...] }`），兼容 `extensions.world`、SillyTavern `character_book`（角色书）与常见导出变体
- **落地本地**：每本世界书生成三件产物——
  - `名·世界书` 预设：设定全文 + **关键词自动触发**（对话中按触发词注入对应条目）
  - `名·创作` 预设：**创作模式**（创作指令 + 设定全文，激活后输入场景即生成小说正文）
  - `worldbooks/<名>.md`：本地 Markdown 设定文档，可手工编辑
- **设置页**（设置 →「世界书创作」）：世界书列表 / 进入创作 / 世界书模式 / **编辑文档**（系统默认程序打开本地 .md）/ 导入 / 删除
- **对话工具**：`prompt_import_tavern` / `prompt_import_world` 等与设置页共享同一份数据

### 两种模式怎么用

| | 进入创作（激活「·创作」） | 世界书模式（激活「·世界书」） |
| --- | --- | --- |
| **输出形态** | **小说正文**：第三人称连贯叙述，细节符合设定风格，直接输出正文、不复述设定 | **对话/角色扮演回应**：以世界内角色身份与你互动、推进剧情 |
| **设定使用** | 全文注入，模型自觉参考 | 全文注入 + **关键词自动触发**：提到触发词时对应条目当场注入 |
| **交互方式** | 你给场景/情节/人物，模型创作；继续给 → 续写 | 你以第一人称参与，模型以角色回应 |
| **典型指令** | "写一段……"、"描写……的过程" | "我是……，然后呢？"、"把名单给我看看" |
| **适合** | 写小说、场景描写、剧情创作 | 沉浸式角色扮演、互动推演 |

想"写小说"用「进入创作」，想"扮演/对话"用「世界书模式」；两者可随时切换，停用后回到正常会话。

## 安装

### 跟 DSH 说

```text
帮我安装这个插件https://github.com/609476965/dsh-LorebookMD
```

### 从 npm 安装（推荐）

```powershell
dsh plugin --profile web add dsh-lorebookmd
```

发布包已内置构建产物（`lib/`）；`dsh plugin` 会自动把本包加入 `dsh.profile.bundles` 并应用 `cordis.patch.yml`，之后用 `start-dsh.cmd` 正常启动即可，无需 `--patch`。

> 本地试装（未发布时）：`npm pack` 生成 `dsh-lorebookmd-1.0.0.tgz`，然后 `dsh plugin --profile web add ./dsh-lorebookmd-1.0.0.tgz`。

### 手动安装

1. **一键安装**：双击 `install.cmd`（或 `powershell -ExecutionPolicy Bypass -File install.ps1`）。脚本把插件复制到 DSH profile 的 `node_modules`（发布包已内置构建产物，无需本地构建环境）。

2. **挂载**（二选一）：
   - **自动挂载（推荐）**：把 `dsh-lorebookmd` 追加到 `~\.dsh\profiles\web\package.json` 的 `dsh.profile.bundles` 数组，之后用 `start-dsh.cmd` 正常启动即可（DSH 会自动应用插件的 `cordis.patch.yml`，无需 `--patch`）
   - **临时挂载**：双击 `start-dsh-plugin.cmd`（以 `--patch` 加载 `cordis.yml`）

> 以上挂载方式任选其一，勿同时使用（会重复挂载）。打开 `http://127.0.0.1:3080`：设置 →「世界书创作」即可使用；终端应打印 `[prompt-manager] ready: …`。

> 安装原理：正常安装 = 把插件包放进 DSH profile 的 `node_modules`。插件源码的 `@deepseek-ai/*` 依赖由 profile 运行时直接解析（DSH 自带完整运行时包），无需额外依赖链。更新插件：升级安装新版本后重启 DSH 即可。

## 数据位置

| 数据 | 路径 |
| --- | --- |
| 预设（含创作/世界书预设正文） | `~/.dsh/dsh-LorebookMD/presets.json` |
| 世界书条目数据（关键词触发用） | `~/.dsh/dsh-LorebookMD/worldbooks.json` |
| 本地设定文档（可编辑） | `~/.dsh/dsh-LorebookMD/worldbooks/<名>.md` |

## 开发

```powershell
node .dsh-tools/install-deps.mjs   # 首次开发前：重建 node_modules 依赖链（仅开发需要）
npm run bundle    # 构建 lib/client.js（改代码后需重新构建并随提交更新）
npm test          # 运行测试（Node >= 22.18 内置类型剥离）
npm run typecheck # tsc --noEmit 严格检查
```
