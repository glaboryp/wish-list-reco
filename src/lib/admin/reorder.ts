export function moveId(ids: string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = Math.min(ids.length - 1, Math.max(0, from + delta));
  if (to === from) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function moveAnnouncement(name: string, position: number, total: number): string {
  return `«${name}» movido a la posición ${position} de ${total}.`;
}
