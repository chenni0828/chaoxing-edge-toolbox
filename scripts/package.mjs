// Licensed under GPLv3. See NOTICE for the Section 7(b) attribution terms.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else files[relative(resolve(root, 'dist'), filename).replaceAll('\\', '/')] = new Uint8Array(await readFile(filename));
  }
}
await collect(resolve(root, 'dist'));
for (const notice of ['LICENSE', 'NOTICE', 'README.md']) {
  files[notice] = await readFile(resolve(root, notice));
}
files['third-party/fflate-LICENSE'] = await readFile(resolve(root, 'node_modules/fflate/LICENSE'));
files['安装说明.txt'] = new TextEncoder().encode([
  `学习工具箱 v${version}`,
  '',
  '首次安装：将 ZIP 解压到固定文件夹，在 Edge 的 edge://extensions 开启开发人员模式。',
  '点击“加载解压缩的扩展”，选择直接包含 manifest.json 的文件夹。',
  '',
  '升级：将 ZIP 中的文件覆盖到原安装目录，再到 edge://extensions 点击“重新加载”。',
  'Chrome 用户可在 chrome://extensions 执行相同步骤。安装或升级后，请刷新已打开的学习页面。',
  '',
  '正式版与更新说明：https://github.com/chenni0828/chaoxing-edge-toolbox/releases',
  '',
].join('\r\n'));
await mkdir(resolve(root, 'release'), { recursive: true });
const destination = resolve(root, `release/chaoxing-edge-toolbox-${version}.zip`);
await writeFile(destination, zipSync(files, { level: 9 }));
console.log(`安装压缩包：${destination}`);
