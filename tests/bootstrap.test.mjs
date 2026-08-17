// Unit tests for node-bootstrap step 06b (browse directory-picker pin).
// Zero-dependency node:test; imports the pure applyPickerPatch only — the
// module's main guard must keep import side-effect free (no downloads, no exit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPickerPatch } from '../node/node-bootstrap.mjs';

const HOST_ROW = 'dsh-host-directory-picker-browse';
const SURFACE_ROW = 'dsh-client-ui-directory-picker-browse';
const DISABLE = /id: directory-picker\n\s+disabled: true/;

test('missing file content produces the full overlay', () => {
  const r = applyPickerPatch('');
  assert.equal(r.changed, true);
  assert.ok(r.text.includes(HOST_ROW));
  assert.ok(r.text.includes(SURFACE_ROW));
  assert.ok(DISABLE.test(r.text));
});

test('a lone [] empty-array marker is replaced, not appended to', () => {
  const r = applyPickerPatch('# profile patch header\n[]\n');
  assert.equal(r.changed, true);
  assert.ok(!/^\s*\[\]\s*$/m.test(r.text), 'stray [] marker must not survive');
  assert.ok(r.text.includes('# profile patch header'), 'header comment preserved');
  assert.ok(r.text.includes(HOST_ROW));
});

test('existing array entries are preserved and the overlay is appended', () => {
  const existing = '# header\n- id: some-row\n  disabled: true\n- insert:\n    - id: other\n      name: pkg\n';
  const r = applyPickerPatch(existing);
  assert.equal(r.changed, true);
  assert.ok(r.text.startsWith(existing.trimEnd()), 'original content must stay verbatim at the top');
  assert.ok(r.text.includes(HOST_ROW));
});

test('already-pinned content is an idempotent no-op', () => {
  const pinned = `# x\n- id: directory-picker\n  disabled: true\n- insert:\n    - id: directory-picker-browse\n      name: '@deepseek-ai/${HOST_ROW}'\n`;
  const r = applyPickerPatch(pinned);
  assert.equal(r.changed, false);
  assert.equal(r.text, pinned);
});

test('non-array document content fails loud instead of corrupting the file', () => {
  assert.throws(() => applyPickerPatch('not: a\nprofile: patch\n'));
});
