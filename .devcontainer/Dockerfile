# Workbench 开发容器基础镜像。
# 动机说明：保持镜像最小化——只装 Node 工具链与常用调试工具，
# 仓库依赖由 devcontainer.json 的 postCreateCommand 安装（与 CI/本地一致）。

FROM node:20-bookworm

# pnpm 通过 corepack 启用（版本与 packageManager 字段一致：9.4.0）
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

# 常用工具：git、curl、build 工具链（node-pty 等原生模块编译需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
