/**
 * The slash commands typed in the input box.
 * @module commands
 */

/**
 * Every command, used both to dispatch and to print `/help`.
 * @type {ReadonlyArray<{name: string, usage: string, description: string}>}
 */
export const COMMANDS = Object.freeze([
  { name: 'chats', usage: '/chats [text]', description: 'show the chat page, or search chats and contacts by name' },
  { name: 'open', usage: '/open <n|name>', description: 'open a chat by number or name' },
  { name: 'latest', usage: '/latest', description: 'open the chat that last sent you a message' },
  { name: 'remove', usage: '/remove [n|name]', description: 'delete a chat from this computer (default: the open or highlighted chat)' },
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
 * name, or a part of a name that matches exactly one chat (or, given in `extra`, one
 * contact you have no chat with yet). Numbers only count `order`. Names are case-insensitive.
 * @param {string} query
 * @param {string[]} order Chat JIDs in the order `/chats` lists them.
 * @param {(jid: string) => string} nameOf
 * @param {string[]} [extra] JIDs of contacts without a chat, matched by name after the chats.
 * @returns {{jid: string}|{error: string}}
 */
export function resolveChat(query, order, nameOf, extra = []) {
  if (!query) return { error: 'Usage: /open <n|name>' }
  const n = Number(query)
  if (Number.isInteger(n)) {
    return order[n - 1] ? { jid: order[n - 1] } : { error: `No chat number ${query}. Try /chats.` }
  }
  const q = query.toLowerCase()
  const hits = [...order, ...extra].filter((jid) => nameOf(jid).toLowerCase().includes(q))
  const exact = hits.find((jid) => nameOf(jid).toLowerCase() === q)
  if (exact) return { jid: exact }
  if (hits.length === 1) return { jid: hits[0] }
  if (hits.length > 1) return { error: `Ambiguous: ${hits.map(nameOf).join(', ')}` }
  return { error: `No chat or contact matches "${query}". Try /chats.` }
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

/**
 * Whether the input is `cd` or `cd ..`, which goes back to the chat page like a shell would.
 * @param {string} text Trimmed input.
 */
export const isBackWord = (text) => /^cd(\s+\.\.)?$/i.test(text)


/**
 * Contacts without a chat whose name contains `text`, sorted by name.
 * @param {string} text
 * @param {string[]} jids Contacts without a chat.
 * @param {(jid: string) => string} nameOf
 * @returns {string[]}
 */
export function searchContacts(text, jids, nameOf) {
  const q = text.toLowerCase()
  return jids.filter((jid) => nameOf(jid).toLowerCase().includes(q))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
}
