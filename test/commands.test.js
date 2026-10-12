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

test('suggestCommands lists prefix matches first and only while typing the first word', async () => {
  const { suggestCommands } = await import('../src/commands.js')
  assert.equal(suggestCommands('/').length, COMMANDS.length)
  assert.deepEqual(suggestCommands('/vi').map((c) => c.name), ['view'])
  assert.equal(suggestCommands('/image foo').length, 0)
  assert.equal(suggestCommands('hello').length, 0)
  assert.equal(suggestCommands('/zzz').length, 0)
})

test('isExitWord matches only the bare word exit, in any case', async () => {
  const { isExitWord } = await import('../src/commands.js')
  assert.ok(isExitWord('exit') && isExitWord('EXIT') && isExitWord('Exit'))
  assert.ok(!isExitWord('exit now') && !isExitWord('please exit') && !isExitWord(''))
})

test('listChats pages the list and keeps numbers usable with /open', async () => {
  const { listChats } = await import('../src/commands.js')
  const order = Array.from({ length: 40 }, (_, i) => `c${i + 1}`)
  const nameOf = (j) => `Chat ${j}`
  const p1 = listChats('', order, nameOf, 15)
  assert.equal(p1.rows.length, 15)
  assert.match(p1.footer, /Page 1\/3 \(40 chats\)\. \/chats 2/)
  const p3 = listChats('3', order, nameOf, 15)
  assert.deepEqual(p3.rows.map((r) => r.n), [31, 32, 33, 34, 35, 36, 37, 38, 39, 40])
  assert.equal(listChats('99', order, nameOf, 15).rows[0].n, 31) // clamped to the last page
  assert.equal(listChats('', order.slice(0, 5), nameOf, 15).footer, '')
})

test('listChats searches by name and reports no match', async () => {
  const { listChats } = await import('../src/commands.js')
  const order = ['a', 'b', 'c']
  const nameOf = (j) => ({ a: 'Mom', b: 'Work', c: 'Mommy' })[j]
  assert.deepEqual(listChats('MOM', order, nameOf).rows.map((r) => r.n), [1, 3])
  assert.match(listChats('zzz', order, nameOf).footer, /No chat matches/)
})
