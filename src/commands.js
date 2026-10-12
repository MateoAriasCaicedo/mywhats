/**
 * The slash commands typed in the input box.
 * @module commands
 */

/**
 * Every command, used both to dispatch and to print `/help`.
 * @type {ReadonlyArray<{name: string, usage: string, description: string}>}
 */
export const COMMANDS = Object.freeze([
  { name: 'chats', usage: '/chats [page|text]', description: 'list chats, 15 per page, or search by name' },
  { name: 'open', usage: '/open <n|name>', description: 'open a chat by number or name' },
  { name: 'image', usage: '/image <path> [caption]', description: 'send an image (quote paths with spaces)' },
  { name: 'paste', usage: '/paste [caption]', description: 'send the image on your clipboard (Ctrl+V also works)' },
  { name: 'view', usage: '/view [n]', description: 'open the latest image in this chat (n = nth latest)' },
  { name: 'play', usage: '/play [n]', description: 'listen to the latest voice note in this chat (n = nth latest)' },
  { name: 'voice', usage: '/voice', description: 'record a voice note (Enter sends, Esc cancels)' },
  { name: 'help', usage: '/help', description: 'show this help' },
  { name: 'quit', usage: '/quit', description: 'exit' },
])

/**
 * Splits `/name argument` into its parts. The name is everything up to the first space,
 * so typos like `/help!` still count as (unknown) commands instead of being sent as chat
 * messages. Text that does not start with a slash and a name ("hello", "/ hi") or whose
 * first word contains another slash (a path such as "/usr/bin/x") is not a command.
 * @param {string} text Trimmed input.
 * @returns {{name: string, arg: string}|null} `name` is lower-cased, `arg` trimmed.
 */
export function parseCommand(text) {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return null
  return { name: match[1].toLowerCase(), arg: (match[2] ?? '').trim() }
}

/**
 * Finds the chat a user means by `/open`: a 1-based number from `/chats`, an exact
 * name, or a part of a name that matches exactly one chat. Names are case-insensitive.
 * @param {string} query
 * @param {string[]} order Chat JIDs in the order `/chats` lists them.
 * @param {(jid: string) => string} nameOf
 * @returns {{jid: string}|{error: string}}
 */
export function resolveChat(query, order, nameOf) {
  if (!query) return { error: 'Usage: /open <n|name>' }
  const n = Number(query)
  if (Number.isInteger(n)) {
    return order[n - 1] ? { jid: order[n - 1] } : { error: `No chat number ${query}. Try /chats.` }
  }
  const q = query.toLowerCase()
  const hits = order.filter((jid) => nameOf(jid).toLowerCase().includes(q))
  const exact = hits.find((jid) => nameOf(jid).toLowerCase() === q)
  if (exact) return { jid: exact }
  if (hits.length === 1) return { jid: hits[0] }
  if (hits.length > 1) return { error: `Ambiguous: ${hits.map(nameOf).join(', ')}` }
  return { error: `No chat matches "${query}". Try /chats.` }
}

/**
 * Commands to suggest in the slash menu for what is typed so far.
 * Only offered while the first word is being typed (no space yet); names that start
 * with the text come before names that merely contain it.
 * @param {string} text Raw input value.
 * @returns {typeof COMMANDS[number][]}
 */
export function suggestCommands(text) {
  if (!/^\/[^\s/]*$/.test(text)) return []
  const q = text.slice(1).toLowerCase()
  const starts = COMMANDS.filter((c) => c.name.startsWith(q))
  return [...starts, ...COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q))]
}

/**
 * Whether the input is the bare word "exit", which quits like /quit does.
 * @param {string} text Trimmed input.
 */
export const isExitWord = (text) => text.toLowerCase() === 'exit'

/** How many chats `/chats` lists per page. */
export const CHATS_PAGE_SIZE = 15

/**
 * Picks the chats `/chats` shows: a page of them (argument is a page number, default 1) or
 * the ones whose name contains the argument. Numbers are positions in `order`, so they are
 * what `/open <n>` expects whichever page or search they came from.
 * @param {string} arg
 * @param {string[]} order Chat JIDs in the order `/chats` lists them.
 * @param {(jid: string) => string} nameOf
 * @param {number} [pageSize]
 * @returns {{rows: Array<{n: number, jid: string}>, footer: string}}
 */
export function listChats(arg, order, nameOf, pageSize = CHATS_PAGE_SIZE) {
  const all = order.map((jid, i) => ({ n: i + 1, jid }))
  if (arg && !/^\d+$/.test(arg)) {
    const q = arg.toLowerCase()
    const rows = all.filter(({ jid }) => nameOf(jid).toLowerCase().includes(q))
    return { rows, footer: rows.length ? '' : `No chat matches "${arg}".` }
  }
  const pages = Math.max(1, Math.ceil(all.length / pageSize))
  const page = Math.min(Math.max(1, Number(arg) || 1), pages)
  const rows = all.slice((page - 1) * pageSize, page * pageSize)
  if (pages === 1) return { rows, footer: '' }
  const next = page < pages ? ` /chats ${page + 1} for the next page.` : ''
  return { rows, footer: `Page ${page}/${pages} (${all.length} chats).${next} /chats <text> searches by name.` }
}
