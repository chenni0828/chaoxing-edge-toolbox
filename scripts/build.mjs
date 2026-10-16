import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
// Bundle the host policy once so the manifest and popup always share the same rules.
const policy = await build({ entryPoints: [resolve(root, 'src/shared/sites.ts')], bundle: true, write: false, format: 'esm' });
const { SITE_MATCHES } = await import(`data:text/javascript;base64,${Buffer.from(policy.outputFiles[0].contents).toString('base64')}`);

export const manifest = {
  manifest_version: 3,
  name: '学习通工具箱',
  version,
  description: '学习通功能工具箱：允许粘贴、题目提取，以及思维阶梯简答题 AI 生成与填入。',
  minimum_chrome_version: '119',
  permissions: ['storage', 'clipboardWrite'],
  host_permissions: SITE_MATCHES,
  optional_host_permissions: ['https://*/*'],
  background: { service_worker: 'background/index.js' },
  options_ui: { page: 'options/index.html', open_in_tab: true },
  action: {
    default_title: '学习通工具箱',
    default_popup: 'popup/index.html',
    default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  },
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  content_scripts: [
    {
      matches: SITE_MATCHES,
      js: ['content/main.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
      world: 'MAIN',
    },
    {
      matches: SITE_MATCHES,
      js: ['content/index.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
      world: 'ISOLATED',
    },
  ],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
};

await mkdir(resolve(root, 'dist/popup'), { recursive: true });
await mkdir(resolve(root, 'dist/options'), { recursive: true });
await cp(resolve(root, 'public/icons'), resolve(root, 'dist/icons'), { recursive: true });
await writeFile(resolve(root, 'dist/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

async function copyPopup() {
  await cp(resolve(root, 'src/popup/index.html'), resolve(root, 'dist/popup/index.html'));
  await cp(resolve(root, 'src/popup/style.css'), resolve(root, 'dist/popup/style.css'));
  await cp(resolve(root, 'src/options/index.html'), resolve(root, 'dist/options/index.html'));
  await cp(resolve(root, 'src/options/style.css'), resolve(root, 'dist/options/style.css'));
  // Shared design tokens imported by both extension pages.
  await mkdir(resolve(root, 'dist/core'), { recursive: true });
  await cp(resolve(root, 'src/core/design-tokens.css'), resolve(root, 'dist/core/design-tokens.css'));
}

const options = {
  entryPoints: {
    'content/main': 'src/content/main.ts',
    'content/index': 'src/content/index.ts',
    'popup/index': 'src/popup/index.ts',
    'options/index': 'src/options/index.ts',
    'background/index': 'src/background/index.ts',
  },
  absWorkingDir: root,
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome119',
  charset: 'utf8',
  sourcemap: false,
  logLevel: 'info',
  legalComments: 'none',
  plugins: [{ name: 'copy-popup', setup(builder) { builder.onEnd(copyPopup); } }],
};

if (process.argv.includes('--watch')) {
  const builder = await context(options);
  await builder.watch();
  const { watch } = await import('node:fs');
  // HTML/CSS are not JS imports, so watch them explicitly.
  for (const directory of ['src/popup', 'src/options', 'src/core']) {
    watch(resolve(root, directory), (_event, filename) => {
      if (filename && /\.(html|css)$/.test(filename)) void copyPopup();
    });
  }
  console.log('正在监听 src/。脚本更新后，请在 edge://extensions 重载扩展并刷新网页。');
} else {
  await build(options);
  console.log('可加载扩展已生成：dist/');
}
