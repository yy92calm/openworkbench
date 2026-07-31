# 离线语音方案

## 概述

为 Workbench 桌面应用新增离线语音能力，包含两部分：

1. **TTS（文字转语音）**：AI 回复消息可朗读播放
2. **STT（语音转文字）**：用户可语音输入，转写为文字填入输入框

全程离线，不依赖云端语音服务。

## 设计

### 技术选型

| 能力 | 方案 | 原理 |
|------|------|------|
| TTS | `window.speechSynthesis` (Web Speech API) | Electron 内置 Chromium 引擎，直接调用操作系统语音引擎，零依赖、全离线 |
| STT | Whisper.cpp（本地 tiny-q5_1 模型） | 主进程 spawn whisper-cli 二进制，renderer 录制 WAV → IPC → 离线转写 |

### 为什么选 Whisper.cpp

- `webkitSpeechRecognition` 在 Electron 中依赖 Google 服务器，无法保证离线
- Whisper.cpp tiny-q5_1 模型仅 ~31MB，二进制 ~2MB，体积可接受
- 转写质量高，支持中英文，完全离线
- 通过 Homebrew 安装 + fetch 脚本复制到 `binaries/whisper/`

### TTS 实现

**触发方式**：
- AI 消息气泡上方新增「朗读」按钮（Volume2 / Speaker 图标）
- 点击开始朗读，再次点击停止
- 朗读中的消息有视觉反馈（图标变为脉冲动画）

**可控参数**（设置页 → 语音选项卡）：
- 启用/禁用语音
- 选择系统语音（`speechSynthesis.getVoices()`）
- 语速（rate，0.5~2.0）
- 音调（pitch，0~2）

**关键文件**：
- `apps/desktop/src/renderer/lib/tts.ts` — TTS 工具模块
- `apps/desktop/src/renderer/components/thread/MessageBubble.tsx` — 添加朗读按钮
- `apps/desktop/src/renderer/app/routes/SettingsPage.tsx` — 语音设置选项卡

### STT 实现

**触发方式**：
- Composer 输入框工具栏新增「麦克风」按钮
- 点击开始录音（16kHz mono PCM），再次点击停止 → 转写 → 文字填入输入框
- 录音中麦克风图标脉冲动画；转写中显示 Loader2 旋转

**技术路径**：
1. Renderer: `AudioContext` + `ScriptProcessorNode` 录制 16kHz mono PCM
2. 编码为 WAV（16-bit PCM）
3. IPC `whisper-transcribe` → 主进程 spawn `whisper-cli -m model -f wav --no-timestamps -l zh`
4. 返回转写文字 → 追加到输入框

**关键文件**：
- `apps/desktop/src/main/whisper.ts` — 主进程 Whisper 桥接模块
- `apps/desktop/src/renderer/lib/stt.ts` — Renderer WAV 录音 + IPC 转写
- `apps/desktop/src/renderer/components/thread/Composer.tsx` — 麦克风按钮
- `scripts/dev/fetch-whisper.sh` — 下载二进制 + 模型脚本
- `apps/desktop/binaries/whisper/` — whisper-cli + ggml-tiny-q5_1.bin

### 设置页语音选项卡

新增 `Section = "voice"` 选项卡：
- TTS 开关 + 语音选择下拉 + 语速/音调滑块
- STT 开关
- 测试按钮（播放一段示例语音）

### 数据流

```
TTS: MessageBubble 朗读按钮 → tts.ts speak(text, opts) → speechSynthesis.speak()
STT: Composer 麦克风 → stt.ts 录音 → encodeWav → IPC whisper-transcribe → main spawn whisper-cli → text → setValue
设置: electron-store key="voice-config" → { ttsEnabled, voiceURI, rate, pitch, sttEnabled }
```

### UI 布局

```
设置页侧边栏：
  通用 | 模型配置 | 运行时 | 语音 | 工作区 | 隐私 | 关于

语音选项卡：
  ┌─ 文字转语音 (TTS) ──────────────────────┐
  │  [开关] 启用朗读                          │
  │  语音: [系统语音下拉框]                    │
  │  语速: ────●────── 1.0                    │
  │  音调: ────●────── 1.0                    │
  │  [测试朗读]                               │
  └──────────────────────────────────────────┘
  ┌─ 语音转文字 (STT) ──────────────────────┐
  │  [开关] 启用语音输入                       │
  │  提示: 使用 Whisper.cpp 本地模型，离线运行  │
  └──────────────────────────────────────────┘
```

### Composer 变更

输入框工具栏新增麦克风按钮（在文件附件按钮左侧）：

```
[🎤] [📎]                    [发送/停止]
```

- 禁用条件：STT 未启用 或 不支持
- 录音中：图标脉冲 + 边框 accent 高亮
- 转写文字追加到当前输入框内容末尾

## 验证状态

- [x] TTS 基础功能（speak / cancel）
- [x] TTS 消息朗读按钮
- [x] TTS 设置（语音选择、语速、音调）
- [x] STT 语音输入按钮（Whisper.cpp）
- [x] STT 离线转写到输入框
- [ ] 构建通过
- [ ] 打包验证
