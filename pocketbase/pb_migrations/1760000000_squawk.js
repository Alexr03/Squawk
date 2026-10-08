/// <reference path="../pb_data/types.d.ts" />
// Squawk collections: daily-challenge scores and per-player profiles (cloud saves). PocketBase 0.23+.
// Players sign in with Discord only: enable the Discord provider on the users collection and turn password auth off.

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');

  // One row per player per day; the game only ever raises it.
  const scores = new Collection({
    type: 'base',
    name: 'scores',
    listRule: '',                                                   // the board is public
    viewRule: '',
    createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id",
    updateRule: "user = @request.auth.id && @request.body.user:isset = false && @request.body.score > score",
    deleteRule: null,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { name: 'name', type: 'text', max: 20 },
      { name: 'day', type: 'text', required: true, pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      { name: 'score', type: 'number', min: 0, max: 100000, onlyInt: true, required: true },
      { name: 'grade', type: 'text', pattern: '^[SABCD]$' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_scores_user_day ON scores (user, day)',
      'CREATE INDEX idx_scores_day_score ON scores (day, score)',
    ],
  });
  app.save(scores);

  // Career progress, merged across devices. Private to its owner.
  const profiles = new Collection({
    type: 'base',
    name: 'profiles',
    listRule: 'user = @request.auth.id',
    viewRule: 'user = @request.auth.id',
    createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id",
    updateRule: 'user = @request.auth.id && @request.body.user:isset = false',
    deleteRule: 'user = @request.auth.id',
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { name: 'progress', type: 'json', maxSize: 200000 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_profiles_user ON profiles (user)'],
  });
  app.save(profiles);

  // Names on the board are public; everything else about a user stays private.
  users.viewRule = '';
  users.passwordAuth.enabled = false;
  app.save(users);
}, (app) => {
  for (const n of ['scores', 'profiles']) { try { app.delete(app.findCollectionByNameOrId(n)); } catch { /* already gone */ } }
});
