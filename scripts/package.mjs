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
files['安装说明.txt'] = new TextEncoder().encode('学习通工具箱\r\n\r\n1. 将此压缩包解压到固定文件夹。\r\n2. Edge 地址栏输入 edge://extensions，开启开发人员模式。\r\n3. 点击“加载解压缩的扩展”，选择含 manifest.json 的解压文件夹。\r\n4. 刷新已打开的学习通网页，点击扩展图标。\r\n5. 允许粘贴默认开启；点击“提取题目”可预览并复制。\r\n\r\n详细说明与源码请查看项目 README.md。\r\n');
await mkdir(resolve(root, 'release'), { recursive: true });
const destination = resolve(root, `release/chaoxing-edge-toolbox-${version}.zip`);
await writeFile(destination, zipSync(files, { level: 9 }));
console.log(`安装压缩包：${destination}`);
