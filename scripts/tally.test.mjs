import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse, renderStatus, replaceStatus, tally } from './tally.mjs';

const body = (name, pc, dinner, payment) =>
  [`이름: ${name}`, `PC방: ${pc}`, `저녁: ${dinner}`, payment ? `결제: ${payment}` : ''].join('\n');
const issue = (number, login, text, state = 'open') => ({
  number, state, title: '[참석] 이름', body: text, user: { login },
});

test('저녁 참석은 결제 방식이 있어야 한다', () => {
  assert.deepEqual(parse(body('가', '참석', '참석', '회식비')), { name: '가', pc: true, dinner: true, payment: '회식비' });
  assert.equal(parse(body('가', '참석', '참석')), null);
  assert.equal(parse(body('가', '참석', '참석', '법카')), null);
});

test('저녁 불참이면 결제 방식을 버린다', () => {
  assert.deepEqual(parse(body('가', '참석', '불참', '사비')), { name: '가', pc: true, dinner: false, payment: null });
});

test('둘 다 불참도 유효한 응답이다', () => {
  assert.deepEqual(parse(body('가', '불참', '불참')), { name: '가', pc: false, dinner: false, payment: null });
});

test('허용하지 않은 값과 빈 이름은 거부한다', () => {
  assert.equal(parse(body('가', '몰라', '불참')), null);
  assert.equal(parse(body('!!!', '참석', '불참')), null);
  assert.equal(parse(null), null);
});

test('CRLF 본문을 읽는다', () => {
  assert.equal(parse(body('가', '참석', '불참').replaceAll('\n', '\r\n')).name, '가');
});

test('이름에서 표와 HTML을 깨는 문자를 지운다', () => {
  assert.equal(parse(body('<b>가|나</b> @x `y` [z](u)', '참석', '불참')).name, 'b가나b x y zu');
});

test('사람별 마지막 응답만 남긴다', () => {
  const { rows } = tally([issue(2, 'a', body('새', '참석', '불참')), issue(1, 'a', body('옛', '불참', '불참'))]);
  assert.deepEqual(rows.map((r) => r.name), ['새']);
});

test('잘못된 응답은 이전 응답을 덮지 않고 invalid로 남는다', () => {
  const { rows, invalid } = tally([issue(1, 'a', body('옛', '참석', '불참')), issue(2, 'a', '엉망')]);
  assert.deepEqual(rows.map((r) => r.name), ['옛']);
  assert.deepEqual(invalid, [2]);
});

test('마지막 응답을 닫으면 명단에서 빠지고 예전 응답이 살아나지 않는다', () => {
  const { rows } = tally([issue(1, 'a', body('옛', '참석', '불참')), issue(2, 'a', body('새', '참석', '불참'), 'closed')]);
  assert.deepEqual(rows, []);
});

test('다른 제목의 이슈와 PR은 무시한다', () => {
  const { rows, invalid } = tally([
    { ...issue(1, 'a', '버그'), title: '버그 제보' },
    { ...issue(2, 'b', body('가', '참석', '불참')), pull_request: {} },
  ]);
  assert.deepEqual(rows, []);
  assert.deepEqual(invalid, []);
});

test('현황 표에 체크와 인원수가 나온다', () => {
  const text = renderStatus([
    { name: '가', github: 'a', pc: true, dinner: true, payment: '회식비' },
    { name: '나', github: 'b', pc: true, dinner: false, payment: null },
  ]);
  assert.match(text, /\*\*1부 참전 명단 2명\*\*: 가, 나/);
  assert.match(text, /\*\*2부 피로연 명단 1명\*\* \(회식비 1명, 사비 0명\): 가\(회식비\)/);
  assert.match(text, /\| 가 \| `a` \| ☑ \| ☑ \| 회식비 \|/);
  assert.match(text, /\| 나 \| `b` \| ☑ \| ☐ \|  \|/);
});

test('README의 표시 구간만 바꾼다', () => {
  const next = replaceStatus('앞\n<!-- status:start -->\n옛\n<!-- status:end -->\n뒤', '$& 새');
  assert.equal(next, '앞\n<!-- status:start -->\n$& 새\n<!-- status:end -->\n뒤');
});
