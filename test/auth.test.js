import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkAuthDir } from '../src/auth.js'

function tmpAuth(creds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whats-auth-'))
  const dir = path.join(root, 'auth')
  fs.mkdirSync(dir)
  if (creds !== undefined) fs.writeFileSync(path.join(dir, 'creds.json'), creds)
  return dir
}

test('missing folder or creds is fine (first run)', () => {
  assert.deepEqual(checkAuthDir('/nonexistent/auth'), { ok: true })
  assert.deepEqual(checkAuthDir(tmpAuth()), { ok: true })
})

test('valid creds are left alone', () => {
  const dir = tmpAuth('{"registered":true}')
  assert.deepEqual(checkAuthDir(dir), { ok: true })
  assert.ok(fs.existsSync(dir))
})

test('empty or truncated creds move the folder aside', () => {
  for (const bad of ['', '{"regis']) {
    const dir = tmpAuth(bad)
    const res = checkAuthDir(dir)
    assert.equal(res.ok, false)
    assert.ok(!fs.existsSync(dir))
    assert.ok(fs.existsSync(path.join(res.backup, 'creds.json')))
  }
})
