import test from 'node:test';
import assert from 'node:assert/strict';
import { taskLines, toggleTask } from '../../shared/mdtasks.js';

const md = `# Plan

- [ ] one
* [x] two
\`\`\`
- [ ] not a task (code)
\`\`\`
> - [ ] quoted
1. [ ] numbered
- [] not a task either`;

test('finds tasks outside code fences', () => {
  assert.deepEqual(taskLines(md), [2, 3, 7, 8]);
});

test('toggles the n-th task only', () => {
  const once = toggleTask(md, 0);
  assert.match(once, /- \[x\] one/);
  assert.match(once, /- \[ \] not a task \(code\)/);
  assert.match(toggleTask(md, 1), /\* \[ \] two/);
  assert.match(toggleTask(md, 2, true), /> - \[x\] quoted/);
  assert.match(toggleTask(md, 3, false), /1\. \[ \] numbered/);
  assert.equal(toggleTask(md, 9), md);
});
