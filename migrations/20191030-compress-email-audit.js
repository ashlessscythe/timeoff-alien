const models = require('../lib/model/db')

module.exports = {
  up: () =>
    models.EmailAudit.findAll()
      .map(rec => rec.update({ body: htmlToText.fromString(rec.body) }), {
        concurrency: 1
      })
      .then(() => console.log('Done!'))
      .catch(err => console.error('Error updating records:', err)),

  // Do nothing
  down: () => Promise.resolve()
}
