/**
 * The slash commands typed in the input box.
 * @module commands
 */

/**
 * Every command, used both to dispatch and to print `/help`.
 * @type {ReadonlyArray<{name: string, usage: string, description: string}>}
 */
export const COMMANDS = Object.freeze([
  { name: 'chats', usage: '/chats', description: 'list chats' },
  { name: 'open', usage: '/open <n|name>', description: 'open a chat by number or name' },
  { name: 'image', usage: '/image <path> [caption]', description: 'send an image (quote paths with spaces)' },
  { name: 'view', usage: '/view [n]', description: 'open the latest image in this chat (n = nth latest)' },
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
