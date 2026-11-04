import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TITLE_PREFIX = '[참석]';
const ATTENDANCE = ['참석', '불참'];
const PAYMENTS = ['사비', '회식비'];

export function parse(body) {
  const fields = {};
  for (const line of (body ?? '').split(/\r?\n/)) {
    const match = line.match(/^(이름|PC방|저녁|결제):\s*(.*?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }

  // 이름은 README와 페이지에 그대로 나가므로 글자·숫자와 일부 기호만 남긴다.
  const name = (fields.이름 ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20);
  if (!/[\p{L}\p{N}]/u.test(name)) return null;
  if (!ATTENDANCE.includes(fields.PC방) || !ATTENDANCE.includes(fields.저녁)) return null;

  const dinner = fields.저녁 === '참석';
  if (dinner && !PAYMENTS.includes(fields.결제)) return null;
  return { name, pc: fields.PC방 === '참석', dinner, payment: dinner ? fields.결제 : null };
}

export function tally(issues) {
  const latest = new Map();
  const invalid = [];
  const responses = issues
    .filter((issue) => !issue.pull_request && issue.user?.login && issue.title.startsWith(TITLE_PREFIX))
    .sort((a, b) => a.number - b.number);

  for (const issue of responses) {
    const parsed = parse(issue.body);
    if (!parsed) {
      invalid.push(issue.number);
      continue;
    }
    latest.set(issue.user.login, { ...parsed, github: issue.user.login, number: issue.number, open: issue.state === 'open' });
  }

  // 마지막 응답을 닫으면 예전 응답으로 되돌아가지 않고 명단에서 빠진다.
  const rows = [...latest.values()]
    .filter((row) => row.open)
    .sort((a, b) => a.number - b.number)
    .map(({ number, open, ...row }) => row);
  return { rows, invalid };
}

export function renderStatus(rows) {
  const box = (checked) => (checked ? '☑' : '☐');
  const count = (test) => rows.filter(test).length;
  return [
    `PC방 ${count((r) => r.pc)}명, 저녁 ${count((r) => r.dinner)}명 (회식비 ${count((r) => r.payment === '회식비')}명, 사비 ${count((r) => r.payment === '사비')}명)`,
    '',
    '| 이름 | GitHub | PC방 | 저녁 | 식사비 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.name} | \`${r.github}\` | ${box(r.pc)} | ${box(r.dinner)} | ${r.payment ?? ''} |`),
  ].join('\n');
}

export function replaceStatus(readme, status) {
  return readme.replace(
    /<!-- status:start -->[\s\S]*<!-- status:end -->/,
    () => `<!-- status:start -->\n${status}\n<!-- status:end -->`,
  );
}

async function github(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

async function fetchIssues() {
  const issues = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/issues?state=all&per_page=100&page=${page}`);
    issues.push(...batch);
    if (batch.length < 100) return issues;
  }
}

async function main() {
  const { rows, invalid } = tally(await fetchIssues());
  writeFileSync('status.json', `${JSON.stringify({ rows }, null, 2)}\n`);
  writeFileSync('README.md', replaceStatus(readFileSync('README.md', 'utf8'), renderStatus(rows)));

  const current = Number(process.env.ISSUE_NUMBER);
  if (invalid.includes(current) && ['opened', 'edited'].includes(process.env.ISSUE_ACTION)) {
    await github(`/issues/${current}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: '내용을 읽지 못해 명단에 반영하지 못했습니다. 초대장 페이지에서 다시 제출해 주세요.' }),
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
