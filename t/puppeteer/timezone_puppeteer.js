const puppeteer = require('puppeteer');
const { expect } = require('chai');
const moment = require('moment');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const baseUrl = 'http://localhost:3000/';
  const randomToken = Date.now();
  const testEmail = `puppeteer_${randomToken}@test.com`;
  let today_tonga, today_usa;

  try {
    // 1. Register a new company
    await page.goto(baseUrl);
    await page.waitForSelector('a[href="/register/"]');
    await page.click('a[href="/register/"]');
    await page.waitForSelector('input[name="company_name"]');
    await page.type('input[name="company_name"]', 'Puppeteer Company ' + randomToken);
    await page.type('input[name="name"]', 'PuppeteerFirst');
    await page.type('input[name="lastname"]', 'PuppeteerLast');
    await page.type('input[name="email"]', testEmail);
    await page.type('input[name="password"]', '123456789012');
    await page.type('input[name="password_confirmed"]', '123456789012');
    await page.select('select[name="country"]', 'US');
    await page.click('#submit_registration');
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const regAlert = await page.$eval('div.alert', el => el.textContent);
    expect(regAlert).to.match(/Registration is complete\.?/i);
    console.log('Registration complete.');

    // 2. Go to company settings and set timezone to Tonga
    await page.goto(baseUrl + 'settings/general/');
    await page.waitForSelector('select[name="timezone"]');
    await page.select('select[name="timezone"]', 'Pacific/Tongatapu');
    await page.click('#company_edit_form button[type="submit"]');
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const tzAlert = await page.$eval('div.alert', el => el.textContent);
    expect(tzAlert).to.match(/successfully/i);
    console.log('Timezone set to Tonga.');

    // 3. Open Book leave modal and get today_tonga
    await page.goto(baseUrl);
    await page.waitForSelector('#book_time_off_btn');
    await page.click('#book_time_off_btn');
    await page.waitForSelector('input.book-leave-from-input');
    today_tonga = await page.$eval('input.book-leave-from-input', el => el.value);
    console.log('today_tonga:', today_tonga);

    // 4. Check calendar page for current day
    await page.goto(baseUrl + 'calendar/');
    const calSelector = `table.month_${moment(today_tonga).format('MMMM')} td.half_1st.day_${moment(today_tonga).format('D')}.current_day_cell`;
    await page.waitForSelector(calSelector, { timeout: 10000 });
    console.log('Calendar current day cell found for Tonga.');

    // 5. Check team view page for current day
    await page.goto(baseUrl + 'calendar/teamview/');
    const teamSelector = `table.team-view-table td.half_1st.day_${moment(today_tonga).format('D')}.current_day_cell`;
    await page.waitForSelector(teamSelector, { timeout: 10000 });
    const monthCaption = await page.$eval('div.calendar-section-caption', el => el.textContent);
    expect(monthCaption).to.include(moment(today_tonga).format('MMMM, YYYY'));
    console.log('Team view current day and month correct for Tonga.');

    // 6. Book a leave
    await page.goto(baseUrl);
    await page.waitForSelector('#book_time_off_btn');
    await page.click('#book_time_off_btn');
    await page.waitForSelector('input.book-leave-from-input');
    await page.waitForTimeout(500); // Wait for modal animation
    // Fill required fields in modal
    const leaveTypeValue = await page.$eval('#leave_type option:not([disabled])', el => el.value);
    await page.select('#leave_type', leaveTypeValue);
    // Optionally set from/to dates if needed (already filled by default)
    await page.click('#submitLeaveBtn');
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const leaveAlert = await page.$eval('div.alert', el => el.textContent);
    expect(leaveAlert).to.match(/New leave request was added/i);
    console.log('Leave booked.');

    // 7. Check My requests page for created at date
    await page.goto(baseUrl + 'requests/');
    await page.waitForSelector('td.date_of_request');
    const requestDate = await page.$eval('td.date_of_request', el => el.textContent.trim());
    expect(requestDate).to.equal(moment(today_tonga).format('YYYY-MM-DD'));
    console.log('Request date matches today_tonga.');

    // 8. Reject the leave
    const rejectBtn = await page.$('input[value="Reject"]');
    if (rejectBtn) {
      await rejectBtn.click();
      console.log('Leave rejected.');
    }

    // 9. Set timezone to Pacific/Midway
    await page.goto(baseUrl + 'settings/general/');
    await page.waitForSelector('select[name="timezone"]');
    await page.select('select[name="timezone"]', 'Pacific/Midway');
    await page.click('#company_edit_form button[type="submit"]');
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const tzAlert2 = await page.$eval('div.alert', el => el.textContent);
    expect(tzAlert2).to.match(/successfully/i);
    console.log('Timezone set to Pacific/Midway.');

    // 10. Get today_usa from Book leave modal
    await page.goto(baseUrl);
    await page.waitForSelector('#book_time_off_btn');
    await page.click('#book_time_off_btn');
    await page.waitForSelector('input.book-leave-from-input');
    today_usa = await page.$eval('input.book-leave-from-input', el => el.value);
    console.log('today_usa:', today_usa);

    // 11. Ensure today_usa is one day behind today_tonga
    expect(moment(today_usa).isBefore(moment(today_tonga), 'day')).to.be.true;
    console.log('today_usa is before today_tonga.');

    // 12. Check calendar and team view for today_usa
    await page.goto(baseUrl + 'calendar/');
    const calSelector2 = `table.month_${moment(today_usa).format('MMMM')} td.half_1st.day_${moment(today_usa).format('D')}.current_day_cell`;
    await page.waitForSelector(calSelector2, { timeout: 10000 });
    await page.goto(baseUrl + 'calendar/teamview/');
    const teamSelector2 = `table.team-view-table td.half_1st.day_${moment(today_usa).format('D')}.current_day_cell`;
    await page.waitForSelector(teamSelector2, { timeout: 10000 });
    const monthCaption2 = await page.$eval('div.calendar-section-caption', el => el.textContent);
    expect(monthCaption2).to.include(moment(today_usa).format('MMMM, YYYY'));
    console.log('Calendar and team view correct for today_usa.');

    // 13. Book a leave in USA timezone
    await page.goto(baseUrl);
    await page.waitForSelector('#book_time_off_btn');
    await page.click('#book_time_off_btn');
    await page.waitForSelector('input.book-leave-from-input');
    await page.waitForTimeout(500); // Wait for modal animation
    // Fill required fields in modal
    const leaveTypeValue2 = await page.$eval('#leave_type option:not([disabled])', el => el.value);
    await page.select('#leave_type', leaveTypeValue2);
    await page.click('#submitLeaveBtn');
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const leaveAlert2 = await page.$eval('div.alert', el => el.textContent);
    expect(leaveAlert2).to.match(/New leave request was added/i);
    console.log('Leave booked in USA timezone.');

    // 14. Check My requests page for created at date (USA)
    await page.goto(baseUrl + 'requests/');
    await page.waitForSelector('td.date_of_request');
    const requestDate2 = await page.$eval('td.date_of_request', el => el.textContent.trim());
    expect(requestDate2).to.equal(moment(today_usa).format('YYYY-MM-DD'));
    console.log('Request date matches today_usa.');

    console.log('✅ Puppeteer timezone test passed!');
  } catch (err) {
    console.error('❌ Puppeteer timezone test failed:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();