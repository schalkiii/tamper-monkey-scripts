# TamperMonkey Scripts

个人使用的 TamperMonkey / Greasemonkey 油猴脚本集合。

## 脚本列表

| 脚本 | 用途 | 版本 |
|------|------|------|
| [auto-verify.user.js](./auto-verify.user.js) | 通用验证码自动识别与填充 | 2.1.0 |
| [iyuu-reseed-checker.user.js](./iyuu-reseed-checker.user.js) | PT 站种页显示 IYUU 可辅种数 | 1.4 |
| [qbittorrent-reseed-tagger.user.js](./qbittorrent-reseed-tagger.user.js) | qBittorrent WebUI 根据辅种数自动打标签 | 0.5.0 |
| [pt-cookie-cleaner.user.js](./pt-cookie-cleaner.user.js) | 移除 PT 站 Cookie 分号后空格，修复 IYUU 签到兼容性 | 2.0.0 |

---

## auto-verify.user.js — 验证码自动识别填充

### 功能

自动识别网页上的验证码图片（图形验证码），通过 OCR 解析后填入对应的输入框。支持多引擎、自动降级、智能匹配。

### 特性

- **多 OCR 引擎**：ddddocr 本地引擎 / ocr.space / 云码 / 0218886 免费接口
- **自动降级链**：ddddocr → ocr.space → 0218886，任一引擎失败自动切换下一个
- **智能关键词匹配**：通过关键词（captcha/verify/code/验证码）自动定位验证码图片和输入框
- **视觉邻近配对**：基于视觉邻近度 + 关键词评分的加权配对算法，防止误填
- **2FA 排除**：自动检测并跳过两步验证（TOTP/2FA/MFA）输入框
- **多事件触发**：DOM 变化、图片重载、页面跳转均自动触发识别
- **黑白名单**：支持全局黑/白名单，按域名控制启用范围
- **手动规则**：可为特定网站配置自定义关键词白名单
- **结果缓存**：相同图片哈希不重复识别，节省 API 调用
- **算术验证码**：通过云码引擎支持加减乘除验证码
- **滑动验证码**：支持简单滑动拼图验证码

### OCR 引擎说明

| 引擎 | 速度 | 费用 | 限制 | 说明 |
|------|------|------|------|------|
| **ddddocr 本地** | ~10ms | 免费 | 无限次 | 默认引擎，需本地运行 `ddddocr_server.py` |
| ocr.space | ~500ms | 免费 | 25000次/月 | 无需注册，使用 `helloworld` key |
| 云码 (jfbym) | ~500ms | 按次计费 | 需 Token | 支持算术验证码，精度更高 |
| 0218886 免费 | ~300ms | 免费 | 未知 | 第三方接口，作为最终降级兜底 |

### 安装

1. 在 TamperMonkey 中导入 `auto-verify.user.js`
2. （可选）启动本地 ddddocr 服务以获得最佳体验：
   ```bash
   pip install ddddocr
   python ddddocr_server.py
   ```
   服务监听 `http://127.0.0.1:9898`，脚本自动检测并优先使用

### 配置

脚本菜单（TamperMonkey 图标 → 脚本名 → 菜单项）：

- **切换 OCR 引擎**：在 ddddocr / ocr.space / 云码 / 免费接口之间切换
- **切换黑白名单模式**：控制脚本生效的域名范围
- **管理网站自定义配置**：为特定域名设置自定义关键词
- **管理手动规则**：查看/删除已保存的手动规则
- **导入/导出规则**：批量备份或迁移规则
- **设置云码 Token**：配置 jfbym API Token（算术验证码必需）
- **清除所有数据**：重置所有配置

### 降级策略

当默认引擎 (ddddocr) 识别失败时，自动按以下顺序降级：

```
ddddocr (本地) → ocr.space (免费) → 0218886 (免费兜底)
```

其他引擎失败时同样会降级到 0218886 免费接口作为最终兜底。

### 技术说明

- ddddocr: ONNX Runtime 驱动，CPU 推理约 10ms，专为验证码优化
- ocr.space: 使用公共 API（`helloworld` key），如需更高限额可到 [ocr.space](https://ocr.space/OCRAPI) 注册免费 key
- 云码: 需到 [jfbym.com](https://www.jfbym.com/) 注册获取 Token
- 0218886: 第三方免费接口，无需配置，但不保证稳定性

---

## ddddocr_server.py — 本地 OCR 服务

配合 `auto-verify.user.js` 使用的本地验证码识别服务。

### 依赖

```bash
pip install ddddocr
```

### 启动

```bash
python ddddocr_server.py
```

服务监听 `http://127.0.0.1:9898`：

- `POST /ocr` — body: `{"image": "<base64>"}` → `{"result": "xxxx"}`
- `GET /health` — 健康检查 → `{"status": "ok"}`

### 性能

| 指标 | 数值 |
|------|------|
| 模型加载 (3模型) | ~0.5s |
| 单次推理 (3模型投票) | ~700ms |
| 识别准确率 | ~90% (4-5位字母数字混合) |

### 投票策略

服务加载 3 个 ddddocr 模型（default + beta + old），对每次识别进行投票：

- **3 模型一致**（忽略大小写）→ 置信度 0.95
- **2 模型一致** → 置信度 0.75
- **default + old 一致但 beta 更长** → 优先取 beta（修正截断问题），置信度 0.8
- **3 模型各不同** → 取 default，置信度 0.4

> 核心洞察：default 和 old 模型倾向截断最后一个字符，beta 模型字符更完整但大小写可能不同。投票策略会检测这种模式并优先采用 beta 的结果。

---

## iyuu-reseed-checker.user.js — IYUU 可辅种数查看

### 功能

在 PT（Private Tracker）站点的种子详情页自动显示该种子的 IYUU 可辅种总数。

### 特性

- 多策略 Hash 提取：支持 `<b>Hash码:</b>`、`Hash码:`、`Info Hash:` 等多种 NexusPHP 页面格式
- 自动从下载链接中提取 Hash（`download.php?hash=xxx` / `download.php?info_hash=xxx`）
- 调用 [IYUU API](http://api.iyuu.cn) 查询辅种数据
- 在「下载种子」行末尾显示结果（如 `可辅种数: 5`）
- 支持简体/繁体中文 PT 站点
- 种子页面无法提取 Hash 时自动跳过

### 安装

直接在 TamperMonkey 中导入 `iyuu-reseed-checker.user.js` 即可。

### 兼容站点

自动匹配 `http*://*/details*.php*` 模式的页面，大部分国内 PT 站均适用。

---

## qbittorrent-reseed-tagger.user.js — qB WebUI 辅种标签

### 功能

在 qBittorrent WebUI 中自动为种子打上辅种数标签，方便根据可辅种数量分类管理。

### 特性

- 在 WebUI 顶部导航栏添加「打可辅种数标签」按钮
- 支持两种扫描模式：
  - **list** — 仅处理当前表格中显示的种子
  - **all** — 处理所有种子
- 按辅种数分级打标签：`Reseed-0` ~ `Reseed-6`、`Reseed-7+`
- Toast 消息提示处理结果（非阻塞）
- 自动跳过无有效辅种数据的种子

### 安装

1. 导入脚本到 TamperMonkey
2. **修改 `@match` 规则**中的 IP 地址为你的 qBittorrent WebUI 地址

```javascript
// @match  http://192.168.10.72:9091/*
// @match  http://127.0.0.1:9091/*
```

### 使用

1. 打开 qBittorrent WebUI
2. 确认左侧已选中要处理的分类 / 标签
3. 点击顶部导航栏的「打可辅种数标签」
4. 输入 `all` 或 `list` 选择扫描范围
5. 等待处理完成，查看 Toast 结果

### 注意事项

- 扫描前建议手动删除已有 `Reseed-*` 标签，避免重复
- 处理大量种子时耗时较长，请耐心等待（单线程逐条查询）
- 依赖 qBittorrent WebUI 的 `torrentsTable` 全局变量

---

## pt-cookie-cleaner.user.js — Cookie 空格清理

### 功能

劫持浏览器 `document.cookie` getter，任何脚本（包括 Cookie Cloud）读取 Cookie 时自动移除分号后的空格，解决 Cookie Cloud → MoviePilot 同步时 cookie 被截断的问题。

### 背景

Cookie Cloud 插件将浏览器 Cookie 上传到 MoviePilot 时，`document.cookie` 标准输出格式为 `key1=val1; key2=val2`（分号后含空格）。MoviePilot 在解析该格式时可能因空格导致 cookie 值遭截断，影响功能。

### 实现原理（v2.0）

通过 `Object.defineProperty` 重写 `document.cookie` 的 getter，在读出的 cookie 字符串上执行 `replace(/;\s+/g, ";")` 移除空格。

**对比 v1.0 改进**：

- v1.0：读取 cookie → 去空格 → 重写回浏览器（*破坏性*：丢失 `Secure`/`SameSite`/`expires` 等属性）
- v2.0：劫持 getter 在读取时去空格（*非破坏性*：不修改 cookie 存储，保留所有原始属性）

### 安装

直接在 TamperMonkey 中导入 `pt-cookie-cleaner.user.js` 即可。

### 覆盖站点

内置 70+ 个常见 PT 站区配规则，包括 HDChina、HDSky、M-Team、TTG 等主流站点。

---

## 许可

MIT License
