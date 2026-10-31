// Calendario de las reservas y las citas. Es un doble: no hay ninguna cuenta real detrás, pero
// conserva la regla que importa: sin `approval_id` no se crea nada.
export function createCalendarEvent({ approvalId }) {
  if (!approvalId) return { ok: false, created: false, error: 'approval_id required' };
  return { ok: true, created: true, event_id: `cal-${String(approvalId).slice(0, 48)}` };
}
