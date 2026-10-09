/// <reference path="../pb_data/types.d.ts" />
// A score row stays on its day: updates may raise the score but not move the row to another date
// (that let a player post to a daily challenge they never played).
migrate((app) => {
  const scores = app.findCollectionByNameOrId('scores');
  scores.updateRule = "user = @request.auth.id && @request.body.user:isset = false && @request.body.day:isset = false && @request.body.score > score";
  return app.save(scores);
}, (app) => {
  const scores = app.findCollectionByNameOrId('scores');
  scores.updateRule = "user = @request.auth.id && @request.body.user:isset = false && @request.body.score > score";
  return app.save(scores);
});
