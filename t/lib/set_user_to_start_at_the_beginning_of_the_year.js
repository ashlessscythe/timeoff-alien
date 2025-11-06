'use strict'

const openPageFunc = require('./open_page')
const userInfoFunc = require('./user_info')
const submitFormFunc = require('./submit_form')
const config = require('./config')
const moment = require('moment')

const getUserId = async ({ userId, email, driver }) => {
  if (userId) {
    return userId
  }
  const { user: { id } } = await userInfoFunc({ email, driver })
  return id
}

module.exports = async ({
  driver,
  email,
  userId = null,
  year = moment.utc().year(),
  applicationHost = config.get_application_host(),
  overwriteDate = null
}) => {
  const id = await getUserId({ userId, email, driver })
  
  await openPageFunc({ driver, url: `${applicationHost}users/edit/${id}/` })
  
  await submitFormFunc({
    driver,
    form_params: [
      {
        selector: 'input#start_date_inp',
        value: overwriteDate
          ? overwriteDate.format('YYYY-MM-DD')
          : `${year}-01-01`
      }
    ],
    submit_button_selector: 'button#save_changes_btn',
    message: /Details for .* were updated/
  })
  
  await openPageFunc({ driver, url: applicationHost })
  
  return { driver }
}
