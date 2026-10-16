# 学习通 Edge 工具箱

本仓库保存扩展源码。推送到 `main` 后，GitHub Actions 会检查并构建 `dist/`，再把包含可加载扩展文件的 ZIP 上传为该次工作流的 Artifact。

## 下载并安装

1. 打开仓库的 **Actions → 构建 Edge 扩展 → 最新成功运行**。
2. 在运行页面的 **Artifacts** 下载 `chaoxing-edge-toolbox-...`，解压后再解压其中的扩展 ZIP。
3. 打开 Edge 的 `edge://extensions`，开启开发人员模式，选择“加载解压缩的扩展”，指向含 `manifest.json` 的目录。
4. 刷新已打开的学习通网页。

Artifact 默认保存 30 天。若已过期，可以在 Actions 页面手动运行此工作流重新生成。

## 本地开发

需要 Node.js 22 或更新版本。运行 `npm ci` 和 `npm run build`，然后在 Edge 中加载生成的 `dist/`。`npm run typecheck` 与 `npm run lint` 分别检查类型与代码；`npm run check` 依次完成检查和构建。修改源码后需重新构建、重载扩展并刷新网页。

代码按功能放在 `src/features/`；`src/content/`、`src/background/`、`src/options/` 与 `src/popup/` 是入口。API Key 由用户在扩展设置页填写，勿写入仓库。
