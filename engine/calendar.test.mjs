import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarEvent } from './calendar.mjs';

test('sin approval_id no se crea ningún evento', () => {
  assert.deepEqual(createCalendarEvent({}), { ok: false, created: false, error: 'approval_id required' });
  assert.equal(createCalendarEvent({ approvalId: '' }).created, false);
});

test('con approval_id el evento queda ligado a esa aprobación', () => {
  const out = createCalendarEvent({ approvalId: 'apr-1234' });
  assert.equal(out.created, true);
  assert.equal(out.event_id, 'cal-apr-1234');
});
