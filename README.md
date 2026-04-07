# Grok Imagine 下载器 v2.0

> 在 `grok.com/imagine/saved` 画廊页面，一键同步下载视频/图片 + 提示词 TXT 文件

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 💾 **批量下载** | 选中多个媒体 → 工具栏「💾 下载+提示词」→ 批量下载全部选中项（视频+图片+TXT） |
| 💾 **卡片悬浮下载** | 鼠标悬停卡片右下角出现 💾 → 单击即下载该项 |
| 💾 **详情页下载** | 进入媒体详情 → 右侧栏 💾 按钮 → 下载当前媒体 + 提示词 |
| 📝 **原生按钮增强** | 点击 Grok 原生「下载」按钮时自动同步保存提示词 TXT |

## 📦 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 打开 Tampermonkey 管理面板 → **创建新脚本**
3. 删除模板内容，粘贴 `grok-imagine-downloader.user.js` 的全部内容
4. `Cmd+S` / `Ctrl+S` 保存
5. 访问 `grok.com/imagine/saved` 即可使用

## 🛠 技术原理

### 数据提取
- 通过遍历 React Fiber 内部状态 (`__reactFiber$`) 提取 `memoizedProps.data`
- 提示词路径: `data.prompt` / `data.originalPost.prompt`
- 媒体 URL 优先级:
  1. `data.childPosts[]` → 视频子项 (Image-to-Video 场景)
  2. `data.videos[]` → 视频数组
  3. `data.hdMediaUrl` → 高清 URL
  4. `data.mediaUrl` → 普通 URL

### 选择状态检测
- 选中的卡片通过 `aria-label="Deselect"` 按钮识别
- 批量工具栏通过检测「下载」文字按钮定位

### 页面监控
- MutationObserver + 定时轮询双机制
- SPA 路由切换自动感知

## 📝 下载文件格式

```
Grok_20260407_150030_prompt_text_here.mp4   ← 视频文件
Grok_20260407_150030_prompt_text_here.txt   ← 提示词文本
```

TXT 文件内容包含完整提示词及导出时间戳。

## ⚠️ 注意事项

- 批量下载时每个文件间隔 1 秒，避免浏览器拦截
- 首次使用批量下载可能需要允许浏览器多文件下载权限
- 如果 Grok 更新了 React 内部属性名，脚本可能需要更新
