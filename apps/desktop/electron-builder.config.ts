import { Configuration } from 'electron-builder';

const config: Configuration = {
  appId: 'com.workbench.app',
  productName: 'Workbench',
  publish: [],
  directories: {
    output: 'release',
  },
  extraResources: [
    {
      from: 'binaries',
      to: 'binaries',
      filter: [
        'opencode',
        'opencode.exe',
        // 整个 whisper/ 目录：whisper-cli（macOS 自 brew 拷贝 / Windows 自编译）
        // + ggml-tiny-q5_1.bin 模型。精确文件名 filter 匹配不到子目录文件。
        'whisper/**',
      ],
    },
    {
      from: '../../app-config/.opencode',
      to: 'app-config/.opencode',
    },
    {
      from: '../../app-config/.claude',
      to: 'app-config/.claude',
    },
    {
      from: 'scripts',
      to: 'scripts',
      filter: ['mcp_scheduler.mjs'],
    },
    {
      from: 'out/main',
      to: 'out/main',
      filter: ['browser-mcp-server.mjs'],
    },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    icon: 'build-resources/icon.icns',
  },
  win: {
    target: ['nsis'],
    icon: 'build-resources/icon.png',
  },
  linux: {
    target: ['AppImage'],
    icon: 'build-resources/icon.png',
  },
};

export default config;
