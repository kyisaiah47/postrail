/** What a slot's status means to a reader. A due slot that has not posted is owed, never skipped. */
export function slotStatus(slot, halt) {
  if (slot.status === 'posted') return { key: 'posted', label: 'Posted' };
  if (slot.status === 'missed') return { key: 'missed', label: 'Missed: the window closed' };
  if (halt && slot.due) return { key: 'stopped', label: `Stopped: ${halt.signal}` };
  if (slot.due) return { key: 'owed', label: slot.lastRefusal || slot.lastError ? 'Owed, retrying' : 'Owed' };
  return { key: 'planned', label: 'Planned' };
}

export const host = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/^dry:\/\//, 'dry ').slice(0, 48);
