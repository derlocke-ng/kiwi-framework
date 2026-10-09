// Markdown task lists ("- [ ] milk") inside notes: find and toggle them in the
// source so a click on a rendered checkbox can be saved back. Kept free of
// marked/DOMPurify so it can be unit tested under node.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/;

/** Line indexes of task items, in document order, skipping fenced code. */
export function taskLines(md) {
  const lines = String(md ?? '').split('\n');
  const out = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(FENCE);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (!fence && TASK.test(line)) out.push(i);
  });
  return out;
}

/** Flip the n-th task (0-based, matching the n-th rendered checkbox). */
export function toggleTask(md, n, checked) {
  const lines = String(md ?? '').split('\n');
  const i = taskLines(md)[n];
  if (i == null) return md;
  lines[i] = lines[i].replace(TASK, (_, a, mark, b) => {
    const on = checked ?? mark === ' ';
    return `${a}${on ? 'x' : ' '}${b}`;
  });
  return lines.join('\n');
}
