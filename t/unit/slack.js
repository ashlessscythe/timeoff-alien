'use strict'

const expect = require('chai').expect
const _ = require('underscore')
const bluebird = require('bluebird')
const Slack = require('../../lib/slack')

describe('Check Slack', function () {
  it('Knows how to render and parse template', function (done) {
    var slack = new Slack()

    bluebird
      .resolve(
        slack.promise_rendered_slack_template({
          template_name: 'foobar',
          context: {
            user: {
              name: 'FOO',
              reload_with_session_details: function () {
                return bluebird.resolve(1)
              }
            }
          }
        })
      )
      .then(function (slack_obj) {
        expect(slack_obj.text).to.match(/Hello FOO\./)

        done()
      })
  })
})
