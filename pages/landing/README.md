# HamunaAgent Landing Page

scroll-world 风格的桌面 App 营销 landing page,展示 HamunaAgent 8 个核心能力场景。

## 启动

```bash
cd /home/hmcz/Projects/openbitfun/landing
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/
```

向下滚动浏览 8 个场景:量化策略 / 广告片 / 短剧 / 多智能体团队 / 自定义 MiniApp / 长任务 / 自进化 / 跨设备。每个场景是 clay diorama 风格的微缩世界,镜头跟随 scroll 飞入场景。

## 目录结构

```
landing/
├── index.html             # 入口页面 + 主题色
├── engine.js              # scroll-world 自带的 scrub engine(vanilla JS)
├── sections.json          # 8 段场景配置(文案 + 视频 + 配色)
├── README.md              # 本文件
└── assets/
    ├── brand/
    │   └── mark.webp      # HamunaAgent 应用图标(去底+调色版,匹配 sw-accent)
    ├── quant.webp         # 8 张 stills(每段场景海报)
    ├── ads.webp
    ├── drama.webp
    ├── team.webp
    ├── miniapp.webp
    ├── long.webp
    ├── evolve.webp
    ├── cross.webp
    └── vid/
        ├── dive_01_quant.mp4 ~ dive_08_cross.mp4  # 8 段 dive-in 视频(8s 720P)
        └── conn_01.mp4 ~ conn_07.mp4              # 7 段 connector 视频(5s 720P,场景间过渡)
```

## 数据流

1. **stills**(Agnes `agnes-image-2.5-flash` 生成)→ **dive 视频**(Agnes `agnes-video-2.5-flash` `mode:"keyframe"`,首帧 = still,8s 720P,16:9)
2. **connector 视频**(Agnes `agnes-video-2.5-flash` `mode:"keyframe"`,first_frame = dive_i 末帧 + last_frame = dive_{i+1} 首帧,5s 720P)→ **缝对齐**
3. **ffmpeg 编码**:`-an -vf unsharp=5:5:0.8 -c:v libx264 -crf 20 -g 8 -movflags +faststart`(blob URL 友好)
4. **scrub engine**(`engine.js`)按 scroll 位置在 15 个视频间无缝切换,blob fetch → 内存播放 → 解决 HTTP host 不支持 byte-range 的问题

## 与 desktop app 的关系

landing 与 desktop app 完全独立:
- `dist/welcome/` 是 desktop onboarding 路径(J-4 永久跳过,但素材保留作为回归用)
- `landing/` 是独立的静态营销站,可单独部署到 CDN,`pnpm run web-ui:build` 不会擦掉

## 待办 / 决策点

- [x] **CTA**:单 primary 按钮「免费下载 HamunaAgent 0.3.226」→ `https://download.agent.hamuna.club/releases/v0.3.226/HamunaAgent_0.3.226_x64-setup.exe`(已去 GitHub 入口)
- [x] **首屏 loader**:`#boot-veil` 全屏 cover + 进度条,等 15 个 mp4 全部 `seeked` 才淡出,4 并发预热,90s hardCap 兜底
- [ ] **CDN 国内镜像**:Vercel 海外 only,国内 200-800KB/s → 首段 dive 3.3MB 白屏 4-6s。线上 deploy 前必须配国内镜像(阿里云 OSS / 七牛 / 腾讯云静态站 + DNS 分地域解析)
- [ ] **i18n 双语**:目前纯中文(`<html lang="zh-CN">`),如需英文版需要在 `engine.js` 加 `t()` helper 接受 `{zh, en}` 对象,并加语言切换按钮(参考 phase K engine.js 改动)
- [ ] **手机竖屏**:目前只做了 PC 横屏 16:9 链;手机访问会被 `object-fit: cover` 居中裁切。要原生 9:16 链需要补 8 个 dive + 7 个 connector 竖屏版(~2 小时串行 Agnes)
- [ ] **减少 duration**:dive 8s + connector 5s 总滚动量 ~89vh,可在 `sections.json` 调 `diveScroll`/`connScroll` 压缩到 1 屏

## 复用经验

(放在 snapshot.md 工作日志里更合适,这里只简记)

1. **probe 优先**:第一张 still 渲染成功后再批量 7 张,避免 prompt 风格不一致时全部废掉
2. **MCP `force_key_masked`**:submit 立刻存 `submit_key_masked`,query 必须传同一个 key,否则 404
3. **submit 也可能 429**:dive_05 第一次撞 429,等 60s 重试 OK
4. **img.remit.ee SSL 偶发**:MCP 工具把本地 first/last_frame 上传到 img.remit.ee 转 HTTPS,SSL EOF 错误撞到两次,sleep 60s 重试 OK
5. **scene background 偏离 "plain solid"**:实际 still 背景有渐变 cream + 暖色光晕,但因为页面背景是相同 cream,看不出来,接受
