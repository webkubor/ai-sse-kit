/**
 * Immutable patch helpers for chat message lists — independent of any specific
 * message shape.
 *
 * Solves the "copy the array, find the target message, merge fields" template that
 * shows up at every streaming/async backfill site. Two ways to locate the target:
 *   - `patchLastAssistant`: the streaming case — the reply is always the last item,
 *     patched as each delta arrives.
 *   - `patchMessageById`: cases where the UI can append more messages while a request
 *     is in flight, so position isn't fixed and lookup has to go by id.
 *
 * Convention: when the target can't be found, the input array is returned unchanged
 * (same reference) — no pointless re-render.
 */

/** A patch is either a partial object, or a function computing one from the current value. */
type Patch<T> = Partial<T> | ((current: T) => Partial<T>)

function resolvePatch<T>(patch: Patch<T>, current: T): Partial<T> {
  return typeof patch === 'function' ? (patch as (c: T) => Partial<T>)(current) : patch
}

/**
 * Patches the last message in the list if it has the given `role` (default
 * `'assistant'`) — the standard shape for streaming backfill. No-op (returns `list`
 * unchanged) when the last message isn't that role, or the list is empty.
 */
export function patchLastAssistant<T extends { role: string }>(
  list: T[],
  patch: Patch<T>,
  role: string = 'assistant',
): T[] {
  const last = list[list.length - 1]
  if (last?.role !== role) return list
  return [...list.slice(0, -1), { ...last, ...resolvePatch(patch, last) }]
}

/** Patches the message with the given `id`. No-op when no message has that id. */
export function patchMessageById<T extends { id: string }>(list: T[], id: string, patch: Patch<T>): T[] {
  let hit = false
  const next = list.map((item) => {
    if (item.id !== id) return item
    hit = true
    return { ...item, ...resolvePatch(patch, item) }
  })
  return hit ? next : list
}
