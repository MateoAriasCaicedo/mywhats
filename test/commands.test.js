import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMANDS, parseCommand, resolveChat } from '../src/commands.js'

test('parseCommand splits the name from the argument', () => {
  assert.deepEqual(parseCommand('/chats'), { name: 'chats', arg: '' })
  assert.deepEqual(parseCommand('/open Alice'), { name: 'open', arg: 'Alice' })
  assert.deepEqual(parseCommand('/image "C:\\my pics\\cat.png" nice  cat '), {
    name: 'image', arg: '"C:\\my pics\\cat.png" nice  cat',
  })
})

test('parseCommand ignores case in the name only', () => {
  assert.deepEqual(parseCommand('/OPEN Alice'), { name: 'open', arg: 'Alice' })
})

test('parseCommand returns null for ordinary text', () => {
  assert.equal(parseCommand('hello'), null)
  assert.equal(parseCommand('/ hello'), null)
  assert.equal(parseCommand('/'), null)
  assert.equal(parseCommand('see /chats'), null)
})

test('parseCommand treats typos as (unknown) commands so they are never sent as messages', () => {
  for (const typo of ['/help!', '/chats2', '/open1', '/voice.', '/image-x', '/123']) {
    assert.equal(parseCommand(typo)?.name, typo.slice(1), typo)
  }
})

test('parseCommand leaves path-like text alone', () => {
  assert.equal(parseCommand('/usr/bin/env'), null)
  assert.equal(parseCommand('//comment'), null)
})

test('every command is documented with a usage that starts with its name', () => {
  const names = COMMANDS.map((c) => c.name)
  assert.equal(new Set(names).size, names.length)
  for (const c of COMMANDS) {
    assert.ok(c.usage.startsWith(`/${c.name}`), c.name)
    assert.ok(c.description.length > 0, c.name)
  }
})

const NAMES = { a: 'Alice', b: 'Bob', c: 'Alicia Keys', d: 'Project Team' }
const order = ['a', 'b', 'c', 'd']
const nameOf = (jid) => NAMES[jid]

test('resolveChat opens by 1-based number', () => {
  assert.deepEqual(resolveChat('1', order, nameOf), { jid: 'a' })
  assert.deepEqual(resolveChat('4', order, nameOf), { jid: 'd' })
})

test('resolveChat rejects numbers out of range', () => {
  assert.match(resolveChat('0', order, nameOf).error, /No chat number 0/)
  assert.match(resolveChat('9', order, nameOf).error, /No chat number 9/)
})

test('resolveChat matches names case-insensitively, by part', () => {
  assert.deepEqual(resolveChat('bob', order, nameOf), { jid: 'b' })
  assert.deepEqual(resolveChat('team', order, nameOf), { jid: 'd' })
})

test('resolveChat prefers an exact name over a longer partial match', () => {
  assert.deepEqual(resolveChat('alice', order, nameOf), { jid: 'a' })
})

test('resolveChat reports ambiguous and unknown names', () => {
  assert.equal(resolveChat('ali', order, nameOf).error, 'Ambiguous: Alice, Alicia Keys')
  assert.match(resolveChat('zed', order, nameOf).error, /No chat matches "zed"/)
})

test('resolveChat explains usage for an empty query', () => {
  assert.match(resolveChat('', order, nameOf).error, /Usage/)
})
