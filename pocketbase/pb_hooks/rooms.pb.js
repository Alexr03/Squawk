/// <reference path="../pb_data/types.d.ts" />
// Co-op room ownership. A room's host may update it; nobody else may, except to take over a room whose host has gone
// silent (no heartbeat for 45 s), which is how a guest carries the shift on when the host drops. The host field can only
// ever be set to the requester.

onRecordUpdateRequest((e) => {
  const before = e.record.original();
  const me = e.auth?.id;
  if (!me) throw new UnauthorizedError('Sign in to host a room');
  const host = before.get('host');
  if (host !== me) {
    const quietMs = Date.now() - new Date(before.getDateTime('updated').string().replace(' ', 'T')).getTime();
    if (quietMs < 45000) throw new ForbiddenError('This room is still hosted');
    e.record.set('host', me); // takeover
  } else if (e.record.get('host') !== me) {
    throw new ForbiddenError('A room can only be handed over by its host going quiet');
  }
  e.next();
}, 'rooms');
