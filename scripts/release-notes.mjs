import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG_PATTERN = /^v(\d+(?:\.\d+){0,3})$/;
const TYPE_PATTERN = /^([a-z]+)(?:\([^)]+\))?!?:/i;
const DEFAULT_REPOSITORY = 'chenni0828/chaoxing-edge-toolbox';

export function parseVersionTag(tag) {
  const match = TAG_PATTERN.exec(tag.trim());
  return match ? match[1].split('.').map(Number) : null;
}

export function compareReleaseTags(left, right) {
  const a = parseVersionTag(left);
  const b = parseVersionTag(right);
  if (!a || !b) throw new Error(`无效的版本标签：${left} / ${right}`);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function findPreviousTag(tags, currentTag) {
  const candidates = tags
    .map(tag => tag.trim())
    .filter(tag => tag && tag !== currentTag && parseVersionTag(tag) !== null)
    .sort((a, b) => compareReleaseTags(b, a));
  return candidates[0];
}

export function formatReleaseNotes({ tag, previousTag, commits, repository = DEFAULT_REPOSITORY }) {
  const groups = [
    { key: 'feat', title: '新功能', items: [] },
    { key: 'fix', title: '问题修复', items: [] },
    { key: 'other', title: '其他变更', items: [] },
  ];

  for (const commit of commits) {
    const subject = commit.subject.trim();
    if (!subject) continue;
    const type = TYPE_PATTERN.exec(subject)?.[1].toLowerCase();
    const shortSha = commit.sha.trim().slice(0, 7);
    const entry = shortSha ? `- ${subject} (${shortSha})` : `- ${subject}`;
    if (type === 'feat') groups[0].items.push(entry);
    else if (type === 'fix') groups[1].items.push(entry);
    else groups[2].items.push(entry);
  }

  const sections = groups
    .filter(group => group.items.length > 0)
    .map(group => `### ${group.title}\n${group.items.join('\n')}`);

  if (sections.length === 0) {
    sections.push('### 更新内容\n- 本版本无新增提交记录。');
  }

  if (repository) {
    const changelogUrl = previousTag
      ? `https://github.com/${repository}/compare/${previousTag}...${tag}`
      : `https://github.com/${repository}/commits/${tag}`;
    sections.push(`**完整变更记录**：${changelogUrl}`);
  }

  return `${sections.join('\n\n')}\n`;
}

function readGitLines(args) {
  const output = execFileSync('git', args, { encoding: 'utf8' });
  return output.split(/\r?\n/).filter(Boolean);
}

export function collectCommits(tag, previousTag) {
  const range = previousTag ? `${previousTag}..${tag}` : tag;
  return readGitLines(['log', '--no-merges', '--format=%H%x1f%s', range]).map((line) => {
    const separator = line.indexOf('\x1f');
    return separator === -1
      ? { sha: '', subject: line }
      : { sha: line.slice(0, separator), subject: line.slice(separator + 1) };
  });
}

function parseCliArgs(argv) {
  const options = {
    tag: process.env.GITHUB_REF_NAME ?? '',
    repository: process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
    out: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--tag' && value) {
      options.tag = value;
      index += 1;
    } else if (flag === '--repo' && value) {
      options.repository = value;
      index += 1;
    } else if (flag === '--out' && value) {
      options.out = value;
      index += 1;
    } else {
      throw new Error(`无法识别的参数：${flag}`);
    }
  }
  if (!parseVersionTag(options.tag)) {
    throw new Error(`请通过 --tag 提供有效的正式版标签（例如 v0.2.1），当前值：${options.tag || '空'}`);
  }
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const mergedTags = readGitLines(['tag', '--merged', options.tag, '--list', 'v*']);
  const previousTag = findPreviousTag(mergedTags, options.tag);
  const commits = collectCommits(options.tag, previousTag);
  const notes = formatReleaseNotes({
    tag: options.tag,
    previousTag,
    commits,
    repository: options.repository,
  });

  if (options.out) {
    const destination = resolve(options.out);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, notes, 'utf8');
  } else {
    process.stdout.write(notes);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
