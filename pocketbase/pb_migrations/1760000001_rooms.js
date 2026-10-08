/// <reference path="../pb_data/types.d.ts" />
// Co-op rooms: an 8-digit code, the host's current WebRTC invite, and guests' answers. Only the handshake passes through
// here; the game itself runs peer to peer. Hosting needs a signed-in player; joining doesn't.

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const rooms = new Collection({
    type: 'base',
    name: 'rooms',
    // No browsing: a room is found only by its exact code (?code=12345678). Its host can always see it.
    listRule: "code = @request.query.code || host = @request.auth.id",
    viewRule: "code = @request.query.code || host = @request.auth.id",
    createRule: "@request.auth.id != '' && @request.body.host = @request.auth.id",
    // The host only; pb_hooks/rooms.pb.js also lets a guest take over a room whose host has gone silent.
    updateRule: "@request.auth.id != ''",
    deleteRule: 'host = @request.auth.id',
    fields: [
      { name: 'code', type: 'text', required: true, pattern: '^[0-9]{8}$' },
      { name: 'host', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { name: 'offer', type: 'json', maxSize: 100000 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_rooms_code ON rooms (code)'],
  });
  app.save(rooms);

  const answers = new Collection({
    type: 'base',
    name: 'answers',
    listRule: 'room.host = @request.auth.id',                  // only the room's host reads the answers
    viewRule: 'room.host = @request.auth.id',
    createRule: '',                                              // guests answer without an account
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'room', type: 'relation', collectionId: rooms.id, maxSelect: 1, cascadeDelete: true, required: true },
      { name: 'offer_id', type: 'text', required: true, max: 16 },
      { name: 'sdp', type: 'json', maxSize: 100000 },
      { name: 'created', type: 'autodate', onCreate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_answers_offer ON answers (room, offer_id)'],
  });
  app.save(answers);
}, (app) => {
  for (const n of ['answers', 'rooms']) { try { app.delete(app.findCollectionByNameOrId(n)); } catch { /* gone */ } }
});
