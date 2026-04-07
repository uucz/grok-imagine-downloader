// ==UserScript==
// @name         Grok Imagine Downloader
// @name:zh-CN   Grok Imagine 下载 + 提示词保存
// @namespace    https://github.com/uucz/grok-imagine-downloader
// @version      2.0.0
// @description  Download Grok Imagine media (videos/images) with prompts saved as TXT files. Supports batch download.
// @description:zh-CN  在 Grok Imagine 画廊页面，一键同步下载视频/图片及其对应的提示词 TXT 文件（支持批量）
// @author       Tayer
// @license      MIT
// @match        https://grok.com/*
// @icon         https://grok.com/favicon.ico
// @homepageURL  https://github.com/uucz/grok-imagine-downloader
// @supportURL   https://github.com/uucz/grok-imagine-downloader/issues
// @downloadURL  https://raw.githubusercontent.com/uucz/grok-imagine-downloader/main/grok-imagine-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/uucz/grok-imagine-downloader/main/grok-imagine-downloader.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════
  //  配置
  // ═══════════════════════════════════════════════════════
  const CONFIG = {
    filePrefix: 'Grok',
    debug: true,
    checkInterval: 600,
    accentColor: '#3b82f6',
    accentHover: '#2563eb',
  };

  const log = (...args) => CONFIG.debug && console.log('[GrokDL]', ...args);

  // ═══════════════════════════════════════════════════════
  //  工具函数
  // ═══════════════════════════════════════════════════════

  /** 生成安全文件名 */
  function makeFileName(prompt) {
    const d = new Date();
    const ts =
      d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') +
      '_' +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0') +
      String(d.getSeconds()).padStart(2, '0');

    let tag = '';
    if (prompt) {
      tag =
        '_' +
        prompt
          .replace(/[\\/:*?"<>|\n\r\t]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 40);
    }
    return `${CONFIG.filePrefix}_${ts}${tag}`;
  }

  /** 延时 */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 根据 URL 猜测扩展名 */
  function guessExt(url, fallback = '.jpg') {
    if (!url) return fallback;
    if (/\.mp4/i.test(url) || /share-videos/i.test(url) || /video/i.test(url)) return '.mp4';
    if (/\.png/i.test(url)) return '.png';
    if (/\.webp/i.test(url)) return '.webp';
    if (/\.gif/i.test(url)) return '.gif';
    return fallback;
  }

  // ═══════════════════════════════════════════════════════
  //  React Fiber 数据提取
  // ═══════════════════════════════════════════════════════

  function findReactFiber(el) {
    if (!el) return null;
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  }

  /**
   * 沿 Fiber.return 链向上搜索，找到第一个包含 `data` 属性的 memoizedProps
   * 返回 { prompt, mediaUrl, mediaType } 或 null
   *
   * 关键逻辑：Image-to-Video 的视频 URL 隐藏在 data.childPosts 或 data.videos 里
   */
  function extractDataFromFiber(fiber, depth = 0, maxDepth = 25) {
    if (!fiber || depth > maxDepth) return null;

    try {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object' && props.data) {
        const d = props.data;
        const op = d.originalPost || {};

        const prompt = d.prompt || d.originalPrompt || op.prompt || op.originalPrompt || null;

        // ─── 第一优先级：从 childPosts / videos 中提取视频 URL ───
        let videoUrl = null;

        // 检查 childPosts 数组 (Image-to-Video 场景)
        if (Array.isArray(d.childPosts)) {
          const videoChild = d.childPosts.find(
            (p) => p.mediaType === 'MEDIA_POST_TYPE_VIDEO' || /\.mp4|video|share-videos/i.test(p.mediaUrl || p.hdMediaUrl || '')
          );
          if (videoChild) {
            videoUrl = videoChild.hdMediaUrl || videoChild.mediaUrl || videoChild.watermarkedMediaUrl;
          }
        }

        // 检查 videos 数组
        if (!videoUrl && Array.isArray(d.videos) && d.videos.length > 0) {
          const v = d.videos[0];
          videoUrl = v.hdMediaUrl || v.mediaUrl || v.url || v.watermarkedMediaUrl;
        }

        // 检查 originalPost 的 childPosts / videos
        if (!videoUrl && op.childPosts && Array.isArray(op.childPosts)) {
          const videoChild = op.childPosts.find(
            (p) => p.mediaType === 'MEDIA_POST_TYPE_VIDEO' || /\.mp4|video|share-videos/i.test(p.mediaUrl || p.hdMediaUrl || '')
          );
          if (videoChild) {
            videoUrl = videoChild.hdMediaUrl || videoChild.mediaUrl || videoChild.watermarkedMediaUrl;
          }
        }

        if (!videoUrl && Array.isArray(op.videos) && op.videos.length > 0) {
          const v = op.videos[0];
          videoUrl = v.hdMediaUrl || v.mediaUrl || v.url;
        }

        // ─── 第二优先级：顶层 URL (用于纯图片或直接视频) ───
        const topLevelUrl =
          d.hdMediaUrl ||
          d.mediaUrl ||
          op.hdMediaUrl ||
          op.mediaUrl ||
          d.watermarkedMediaUrl ||
          op.watermarkedMediaUrl ||
          d.videoUrl ||
          d.video_url ||
          op.videoUrl ||
          d.imageUrl ||
          d.url ||
          op.url ||
          null;

        // ─── 决定最终 URL ───
        // 如果找到了视频子项的 URL，优先使用它
        const finalUrl = videoUrl || topLevelUrl;

        if (prompt || finalUrl) {
          const isVideo =
            !!videoUrl ||
            d.mediaType === 'MEDIA_POST_TYPE_VIDEO' ||
            op.mediaType === 'MEDIA_POST_TYPE_VIDEO' ||
            /\.mp4|video|share-videos/i.test(finalUrl || '');
          return { prompt, mediaUrl: finalUrl, mediaType: isVideo ? 'video' : 'image' };
        }
      }
    } catch (_) {}

    return extractDataFromFiber(fiber.return, depth + 1, maxDepth);
  }

  /**
   * 从一个 DOM 元素出发，向上遍历父元素，在每层尝试读取 React Fiber 数据
   */
  function extractDataFromElement(startEl) {
    if (!startEl) return null;

    let el = startEl;
    for (let i = 0; i < 15; i++) {
      const fiber = findReactFiber(el);
      if (fiber) {
        const data = extractDataFromFiber(fiber);
        if (data && (data.prompt || data.mediaUrl)) return data;
      }
      el = el.parentElement;
      if (!el || el === document.body) break;
    }
    return null;
  }

  /**
   * 专门给「卡片」用：从卡片容器提取 prompt + 媒体 URL
   * 会同时尝试卡片本身、以及卡片内的 video / img 子元素
   */
  function extractCardData(card) {
    // 先尝试卡片本身
    let data = extractDataFromElement(card);
    if (data && data.prompt && data.mediaUrl) return data;

    // 再尝试卡片内的媒体子元素
    const children = card.querySelectorAll('video, img[src*="assets.grok"], img[src*="imagine-public"]');
    for (const child of children) {
      data = extractDataFromElement(child);
      if (data && data.prompt && data.mediaUrl) return data;
    }

    // 如果只拿到部分数据，补充缺失的 mediaUrl
    if (data && data.prompt && !data.mediaUrl) {
      const vid = card.querySelector('video');
      const img = card.querySelector('img[src*="assets.grok"], img[src*="imagine-public"]');
      if (vid && vid.src) data.mediaUrl = vid.src;
      else if (img && img.src) data.mediaUrl = img.src;
    }

    return data;
  }

  // ═══════════════════════════════════════════════════════
  //  详情页提取 (单个媒体打开时)
  // ═══════════════════════════════════════════════════════

  function extractDetailViewData() {
    // 1. 从媒体元素 Fiber 提取
    const mediaEl =
      document.querySelector('video') ||
      document.querySelector('img[src*="assets.grok"], img[src*="imagine-public"]');
    let data = extractDataFromElement(mediaEl);

    // 2. 补充 prompt (ProseMirror 备用)
    if (!data) data = {};
    if (!data.prompt) {
      const pm = document.querySelector('.ProseMirror p, .tiptap p');
      if (pm) {
        const text = pm.textContent?.trim();
        if (text) data.prompt = text;
      }
    }

    // 3. 补充 mediaUrl
    if (!data.mediaUrl) {
      const video = document.querySelector('video');
      if (video) {
        data.mediaUrl = video.src || video.querySelector('source')?.src;
        data.mediaType = 'video';
      } else {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
          if (
            (img.src.includes('assets.grok') || img.src.includes('imagine-public')) &&
            img.offsetWidth > 200
          ) {
            data.mediaUrl = img.src.replace(/\/preview.*$/, '').replace(/_thumbnail/, '');
            data.mediaType = 'image';
            break;
          }
        }
      }
    }

    return data.prompt || data.mediaUrl ? data : null;
  }

  // ═══════════════════════════════════════════════════════
  //  下载功能
  // ═══════════════════════════════════════════════════════

  async function downloadBlob(url, filename) {
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        a.remove();
      }, 2000);
    } catch (err) {
      log('Fetch 失败, 直链重试:', err.message);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
    }
  }

  function downloadText(text, filename) {
    const content = [
      '═══════════════════════════════════════════════',
      '  Grok Imagine - Prompt',
      '  导出时间: ' + new Date().toLocaleString('zh-CN'),
      '═══════════════════════════════════════════════',
      '',
      text,
      '',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 2000);
  }

  /** 下载单个项目 (媒体 + 提示词) */
  async function downloadItem(data) {
    if (!data || !data.mediaUrl) return false;
    const baseName = makeFileName(data.prompt);
    const ext = guessExt(data.mediaUrl, data.mediaType === 'video' ? '.mp4' : '.jpg');

    await downloadBlob(data.mediaUrl, baseName + ext);

    if (data.prompt) {
      await sleep(400);
      downloadText(data.prompt, baseName + '.txt');
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  //  Toast 通知
  // ═══════════════════════════════════════════════════════

  function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.textContent = msg;
    const bg = {
      success: 'linear-gradient(135deg,#10b981,#059669)',
      error: 'linear-gradient(135deg,#ef4444,#dc2626)',
      info: 'linear-gradient(135deg,#3b82f6,#2563eb)',
    };
    el.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%) translateY(20px);
      background:${bg[type] || bg.info}; color:#fff; padding:12px 24px; border-radius:12px;
      font-size:14px; font-weight:500; z-index:99999; box-shadow:0 8px 32px rgba(0,0,0,.3);
      opacity:0; transition:all .3s cubic-bezier(.4,0,.2,1); pointer-events:none;
      backdrop-filter:blur(8px); white-space:nowrap;
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  // ═══════════════════════════════════════════════════════
  //  按钮工厂
  // ═══════════════════════════════════════════════════════

  function makeCircleBtn(id, emoji, title) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.innerHTML = emoji;
    btn.title = title;
    btn.style.cssText = `
      display:inline-flex; align-items:center; justify-content:center;
      width:40px; height:40px; border-radius:9999px; border:none;
      background:${CONFIG.accentColor}; color:#fff; font-size:18px;
      cursor:pointer; transition:all .2s ease;
      box-shadow:0 2px 8px rgba(59,130,246,.4); flex-shrink:0;
    `;
    btn.onmouseenter = () => {
      btn.style.background = CONFIG.accentHover;
      btn.style.transform = 'scale(1.1)';
    };
    btn.onmouseleave = () => {
      btn.style.background = CONFIG.accentColor;
      btn.style.transform = 'scale(1)';
    };
    return btn;
  }

  // ═══════════════════════════════════════════════════════
  //  A) 详情视图 — 单文件下载按钮 (💾)
  // ═══════════════════════════════════════════════════════

  const DETAIL_BTN_ID = 'grok-dl-detail-btn';

  function injectDetailButton() {
    if (document.getElementById(DETAIL_BTN_ID)) return;
    const nativeBtn = document.querySelector('button[aria-label="下载"]');
    if (!nativeBtn) return;
    const hasMedia =
      document.querySelector('video') ||
      document.querySelector('img[src*="assets.grok"], img[src*="imagine-public"]');
    if (!hasMedia) return;

    const btn = makeCircleBtn(DETAIL_BTN_ID, '💾', '下载媒体 + 提示词 TXT');
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.innerHTML = '⏳';
      btn.disabled = true;
      try {
        const data = extractDetailViewData();
        if (!data || !data.mediaUrl) {
          showToast('❌ 未找到可下载的媒体', 'error');
          return;
        }
        const ok = await downloadItem(data);
        showToast(ok ? '✅ 下载成功！' : '❌ 下载失败', ok ? 'success' : 'error');
      } catch (err) {
        showToast('❌ ' + err.message, 'error');
      } finally {
        btn.innerHTML = '💾';
        btn.disabled = false;
      }
    });

    const parent = nativeBtn.parentElement;
    parent.insertBefore(btn, nativeBtn.nextSibling);
    log('✅ 详情页按钮已注入');
  }

  /** 拦截原生下载按钮，自动附带 TXT */
  function interceptNativeDownload() {
    const nativeBtn = document.querySelector('button[aria-label="下载"]');
    if (!nativeBtn || nativeBtn.dataset.grokDl) return;
    nativeBtn.dataset.grokDl = '1';
    nativeBtn.addEventListener(
      'click',
      () => {
        setTimeout(() => {
          const data = extractDetailViewData();
          if (data && data.prompt) {
            downloadText(data.prompt, makeFileName(data.prompt) + '.txt');
            showToast('📝 已同步保存提示词', 'success');
          }
        }, 500);
      },
      true
    );
    log('✅ 原生下载按钮已拦截');
  }

  // ═══════════════════════════════════════════════════════
  //  B) 画廊 — 批量下载按钮 (💾 批量+提示词)
  // ═══════════════════════════════════════════════════════

  const BATCH_BTN_ID = 'grok-dl-batch-btn';

  /** 找到所有已选中的卡片 */
  function findSelectedCards() {
    // 选中的卡片内部有 aria-label="Deselect" 或 "取消选择" 的按钮
    const deselectBtns = document.querySelectorAll(
      'button[aria-label="Deselect"], button[aria-label="取消选择"]'
    );
    const cards = [];
    deselectBtns.forEach((b) => {
      // 向上找到卡片容器
      let el = b;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement;
        if (!el) break;
        if (
          el.className &&
          (el.className.includes('masonry-card') || el.className.includes('group/media'))
        ) {
          cards.push(el);
          break;
        }
      }
    });
    return cards;
  }

  function injectBatchButton() {
    if (document.getElementById(BATCH_BTN_ID)) return;

    // 查找画廊工具栏 —  找 "已选择:" 文本所在的工具栏容器
    // 也可以找文本为 "下载" 且在页面顶部的按钮
    let toolbarDownloadBtn = null;
    const allBtns = document.querySelectorAll('button');
    for (const b of allBtns) {
      const text = b.textContent?.trim();
      const rect = b.getBoundingClientRect();
      if (text && text.includes('下载') && !text.includes('提示词') && rect.top < 80) {
        toolbarDownloadBtn = b;
        break;
      }
    }
    if (!toolbarDownloadBtn) return;

    log('找到工具栏下载按钮，注入批量按钮');

    const btn = document.createElement('button');
    btn.id = BATCH_BTN_ID;
    btn.innerHTML = '💾 下载+提示词';
    // 继承原生按钮样式
    btn.className = toolbarDownloadBtn.className;
    btn.style.cssText = `
      margin-left:8px;
      background:${CONFIG.accentColor} !important;
      color:#fff !important;
      border:none !important;
      cursor:pointer;
    `;

    btn.addEventListener('click', handleBatchDownload);
    toolbarDownloadBtn.parentElement.insertBefore(btn, toolbarDownloadBtn.nextSibling);
    log('✅ 批量下载按钮已注入');
  }

  async function handleBatchDownload(e) {
    e.preventDefault();
    e.stopPropagation();

    const btn = document.getElementById(BATCH_BTN_ID);
    if (!btn) return;

    // 1. 找到选中的卡片
    const cards = findSelectedCards();
    if (cards.length === 0) {
      showToast('⚠️ 未选中任何媒体，请先点击卡片上的 ✓ 选择', 'info');
      return;
    }

    log(`开始批量下载，共 ${cards.length} 个选中项`);
    btn.innerHTML = `⏳ 0/${cards.length}`;
    btn.disabled = true;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < cards.length; i++) {
      btn.innerHTML = `⏳ ${i + 1}/${cards.length}`;
      try {
        const data = extractCardData(cards[i]);
        if (data && data.mediaUrl) {
          await downloadItem(data);
          successCount++;
        } else {
          log(`卡片 ${i + 1} 数据提取失败`, data);
          failCount++;
        }
      } catch (err) {
        log(`卡片 ${i + 1} 下载失败:`, err);
        failCount++;
      }

      // 每个文件间隔 1s，避免浏览器拦截
      if (i < cards.length - 1) await sleep(1000);
    }

    btn.innerHTML = '💾 下载+提示词';
    btn.disabled = false;

    const msg =
      failCount === 0
        ? `✅ 全部完成！成功下载 ${successCount} 个文件`
        : `⚠️ 完成: ${successCount} 成功, ${failCount} 失败`;
    showToast(msg, failCount === 0 ? 'success' : 'info');
  }

  // ═══════════════════════════════════════════════════════
  //  C) 画廊 — 每张卡片上的快速下载按钮 (悬浮显示)
  // ═══════════════════════════════════════════════════════

  const CARD_BTN_CLASS = 'grok-dl-card-btn';

  function injectCardButtons() {
    // 找所有卡片容器
    const cards = document.querySelectorAll(
      '[class*="group/media-post-masonry-card"]'
    );

    cards.forEach((card) => {
      if (card.querySelector('.' + CARD_BTN_CLASS)) return;

      const btn = document.createElement('button');
      btn.className = CARD_BTN_CLASS;
      btn.innerHTML = '💾';
      btn.title = '下载此媒体 + 提示词';
      btn.style.cssText = `
        position:absolute; bottom:8px; right:8px; z-index:999;
        width:32px; height:32px; border-radius:8px; border:none;
        background:rgba(0,0,0,.6); color:#fff; font-size:14px;
        cursor:pointer; opacity:0; transition:opacity .2s;
        display:flex; align-items:center; justify-content:center;
        backdrop-filter:blur(4px);
      `;

      // 确保父容器有 relative
      if (getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }

      // 悬浮显示/隐藏
      card.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
      card.addEventListener('mouseleave', () => (btn.style.opacity = '0'));

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.innerHTML = '⏳';
        try {
          const data = extractCardData(card);
          if (data && data.mediaUrl) {
            await downloadItem(data);
            showToast('✅ 下载成功', 'success');
          } else {
            showToast('❌ 未能提取数据', 'error');
          }
        } catch (err) {
          showToast('❌ ' + err.message, 'error');
        }
        btn.innerHTML = '💾';
      });

      card.appendChild(btn);
    });
  }

  // ═══════════════════════════════════════════════════════
  //  主循环
  // ═══════════════════════════════════════════════════════

  function tick() {
    const path = location.pathname;
    if (!path.includes('/imagine')) return;

    // 详情视图
    injectDetailButton();
    interceptNativeDownload();

    // 画廊视图
    injectBatchButton();
    injectCardButtons();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(tick, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(tick, 800);
  setInterval(tick, CONFIG.checkInterval);

  // ═══════════════════════════════════════════════════════
  //  全局样式
  // ═══════════════════════════════════════════════════════

  const style = document.createElement('style');
  style.textContent = `
    .${CARD_BTN_CLASS}:hover {
      background: ${CONFIG.accentColor} !important;
      transform: scale(1.1);
    }
    #${DETAIL_BTN_ID}:active, #${BATCH_BTN_ID}:active, .${CARD_BTN_CLASS}:active {
      transform: scale(0.95) !important;
    }
    #${DETAIL_BTN_ID}:disabled, #${BATCH_BTN_ID}:disabled {
      opacity: 0.5; cursor: wait;
    }
  `;
  document.head.appendChild(style);

  log('🚀 Grok Imagine 下载器 v2.0 已启动！');
})();
