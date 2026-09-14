# B07 附件可携带备份——设计文档（本卡本轮只交设计）

编制：2026-09-13。代码基线：master `46696e8`（B03-4 后）。
计划卡：[long-term-agent-plan-2026-09-11.md §5 B07](long-term-agent-plan-2026-09-11.md)（L 级，B01 后先交设计）。
卡面边界：**未确定存储与包格式前只交设计，不仓促改备份格式**——本文即是该设计；实现期按 §8 拆串行子 PR 另立卡执行。

## 1. 现状核实

### 1.1 备份 v5 与 Storage 的关系

- 备份 JSON（`BACKUP_VERSION = 5`）只含**元数据**：`task_attachments` 行有 `bucket` / `path`（Storage 坐标），笔记附件表（026）同理；文件本体不在备份内（BLOCKED P0-04 遗留声明 1 明示「文件级打包属后续增强」——本文即该增强的设计）。
- Storage 两个 bucket（`/api/upload` 分流）：图片 → `images`（5MB 上限），其他 → `attachments`（50MB 上限）。
  **对象路径含 userId 前缀**：`{userId}/{timestamp}-{random}.{ext}`（upload/route.ts:48），公开 URL 经
  `getPublicUrl` 生成（`{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`）。
- 协作 CRDT blob（`note_ydocs`）按 067 合同不进备份；本设计与它无交集。

### 1.2 笔记内容里的四类资源形态（卡面要求的区分）

| 形态 | 在内容里的表现 | v5 备份恢复后的现状 |
|---|---|---|
| A. 用户 Storage 附件（图片/文件） | `<img src>` / file-attachment 的 href = 本应用 Storage 公开 URL | 元数据迁移，**文件本体留在旧账号 Storage**——新账号下 URL 指向他人 bucket 前缀，属「依赖原库」的悬挂引用 |
| B. 远程抓取图片（含微信 data-src 还原） | 外站 http(s) URL | 原样保留；外站失效即丢失（043 失效装饰呈现） |
| C. 正文 base64 内联 | `data:image/...;base64` data URL（上传失败回退，use-editor-upload.ts:13,94） | 自包含，恢复天然完整；代价是备份 JSON 体积 |
| D. 失效外链 | 指向已死/外部资源 | 原样保留，UI 失效装饰（与 B 一致） |

**结论：只有 A 类是备份格式缺口；C 天然可携带；B/D 是「URL 导出 ≠ 离线备份」的语义边界，必须如实呈报而非假装覆盖。**

## 2. 目标与非目标

**目标**：可选的「带附件备份」文件包——元数据 JSON + 文件本体 + manifest + 校验和；
恢复到空账号后 A 类资源落到**新账号自己的 Storage** 并重映射 URL，缺文件如实列清单；
大包可取消、坏包不落库、解包不写任意路径。

**非目标**：
- 不改 v5 备份 JSON 的 schema/语义（元数据 JSON 保持现格式；文件包是它的伴生容器）。
- 不承诺 B/D 类离线可用（可选抓取是候选决策 §7-b，默认关闭）。
- 不覆盖协作 blob（067 合同不变）。

## 3. 包格式设计

单个 zip 容器（`.organize-files` 后缀，命名建议 `organize-files-{yyyyMMdd}-{seq}`），STORE 模式为主
（图片/音视频已压缩，压缩收益低、打包省时）：

```
manifest.json                 # 包索引（唯一事实源）
files/{bucket}/{path}         # A 类文件本体，按 bucket/原 path 存放
```

- `manifest.json`：
  - `package_version`（包格式版本，独立于 BACKUP_VERSION 演进）；
  - `files[]`：`{ key: "files/{bucket}/{path}", bucket, path, sha256, size_bytes, mime_type }`；
  - `url_map[]`：`{ old_url, file_key }`——内容 URL → 包内文件 的映射（恢复重映射的依据）；
  - `external_urls[]`：B/D 类 URL 清单（如实声明「未打包」）；
  - `inline_base64_count / total_bytes`：C 类统计；
  - `created_at / app_version / BACKUP_VERSION`（配套 JSON 的版本，供一致性核对）。
- **校验和**：每文件 sha256（manifest 内）+ 整包由 zip 自身 CRC 与恢复期逐文件 sha256 复核；
  manifest 本身不入自己的校验链（无自指）。
- 配套关系：恢复时「JSON 备份 + 文件包」是一对输入；文件包单独存在时不做任何事（不产生部分恢复）。

选 zip 而非 tar 的理由：浏览器/OS 生态随机读取与逐条校验支持好、Node 无额外系统依赖、
恢复期可流式逐 entry 处理。格式细节（加密、分卷）明确不做。

## 4. 导出流程

1. **扫描**（复用备份导出的内容遍历点）：从 `fetchBackupData` 结果的正文 JSON 与 `task_attachments`
   等元数据行中提取 A 类引用——识别规则：URL 匹配本应用 Storage 前缀
   `/storage/v1/object/public/(images|attachments)/`，解析出 `bucket + path`。
2. **分类计数**：A 类进 files/url_map；B/D 类 URL 进 external_urls；C 类按 `data:image` 计数。
3. **下载与打包**：service/用户会话经 Storage API 逐对象下载（凭 URL 的 path，RLS 会话即够，
   不需要 service_role）；边下边写 zip（流式），**AbortSignal 支持取消**，取消即丢弃半成品。
4. **上限与护栏**：包总大小默认上限 **500MB**（候选决策 §7-c）、单文件沿用 bucket 既有上限、
   文件数上限 5,000；超限明确报错（报出已扫到的总量与建议），不静默截断。
5. **产出**：`organize-backup-v5.json`（现有导出）+ `organize-files-*.zip` 两个文件成对交付；
   UI 明示「文件包含 A 类附件本体；外链图片仍依赖原站」。

## 5. 恢复流程

前置：空账号 + 一对输入（JSON + 包）。顺序：**先文件后 JSON**（URL 重映射需要在 JSON 恢复前就绪）。

1. **安全解包**（验收「坏包不写任意路径/不污染原库」）：
   - 逐 entry 校验 `key` 必须匹配 `^files/(images|attachments)/[A-Za-z0-9/._-]+$` 且
     解析后规范化路径不得逃逸 `files/` 前缀（zip-slip 防护：拒绝 `..`、绝对路径、符号链接 entry）；
   - 大小/数量/总字节按 §4 上限复核（防 zip 炸弹：解压总量上限 + 压缩比上限）；
   - 逐文件 sha256 对 manifest 复核；manifest 自身 JSON 解析失败/缺字段 → 整包拒绝。
   - **任何校验失败：不写一行数据库、不上传一个对象**，报告失败清单后退出。
2. **上传到新 Storage**：按 manifest `bucket` 重放对象；路径按新账号改写为
   `{new_userId}/{uuid}.{ext}`（原 path 含旧 userId 前缀，不能复用），生成 `old_url → new_url` 映射。
   上传失败/包内缺文件：该文件记入 `missing[]`，**不阻断**。
3. **恢复 JSON**：走现有 `restore_backup_v2_full`，但在 `prepareRestorePayload` 的内容重写层
   （`rewriteInternalLinks` 同级）增加**URL 重映射**：内容里的 A 类 old_url → new_url；
   `missing[]` 中的 URL 原样保留（成为与 B/D 同类的失效引用，UI 失效装饰如实呈现）。
4. **报告**：恢复完成页明示——迁移对象数/字节数、missing 清单（含原 URL）、external_urls 计数、
   base64 内联计数；「空账号离线可读样本完整」验收 = missing 为空时 A 类全部可读。

## 6. 安全与边界汇总

- 解包路径白名单 + 规范化（zip-slip）；解析用流式（不整包入内存）。
- 包输入不信任：manifest/entry 数量、字节、压缩比、路径全部复核后再落任何东西。
- 恢复仍走既有 restore RPC 权限模型（用户自己的 RLS 会话），**不引入 service_role 写库**。
- 导出下载用用户会话（能下载自己可见的对象），不提升权限。
- mock 模式：Storage 不可用 → 文件包功能在 mock 下禁用（UI 明示），只保留 v5 JSON 路径。

## 7. 候选决策（需用户拍板，不阻塞设计本身；实现立项前必须定）

- **(a) 包格式**：默认提案 zip + STORE；如需跨工具强校验可换 tar+sidecar sha256（影响不大，实现期定稿）。
- **(b) 远程抓取图片可选抓取**：默认不打包（体积/版权/失效语义）；若用户要求，加「尽力抓取外链图片，
  失败进 missing 清单」的开关——建议二期再做。
- **(c) 包大小上限**：默认 500MB / 5,000 文件；按真实使用数据可调。
- **(d) UI 入口**：设置页备份区加「导出带附件备份」第二按钮 + 恢复区接受双文件；或先只做 CLI/脚本
  形态验证再进 UI（建议：脚本先行，UI 随实现卡一起）。

## 8. 实现拆分（串行子 PR，实现期另立卡领取）

| 子 PR | 内容 |
|---|---|
| B07-2 | 导出：扫描/分类/流式打包脚本化实现（脚本形态，候选 (d) 脚本先行）+ 单测（分类/上限/取消） |
| B07-3 | 恢复：安全解包 + Storage 重放 + URL 重映射 + 缺文件清单 + 单测（zip-slip/坏包/炸弹/missing） |
| B07-4 | UI 接入（按 §7-d 决策）+ 空账号端到端演练脚本（复用 B01 演练骨架：A 导出带包 → B 恢复 → 逐项比对 + 离线可读检查） |

## 9. 验收对照（卡面原文 → 设计落点）

| 卡面验收 | 落点 |
|---|---|
| 空账号离线可读样本完整 | §5 恢复流程 3/4（URL 重映射 + missing 空时全部可读） |
| 坏包不写任意路径/不污染原库 | §5-1 安全解包（校验先行，任何失败零落库） |
| 大包可取消 | §4-3 流式打包 + AbortSignal |
| 缺文件列清单，不把 URL 导出称作离线备份 | §4-2 external_urls 如实声明 + §5-4 恢复报告 |
| 区分四类资源 | §1.2 表 + manifest 分类字段 |
| 未确定格式只交设计 | 本文即设计；§7 候选决策待用户，§8 实现另立卡 |
