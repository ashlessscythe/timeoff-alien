const puppeteer = require('puppeteer');
const { expect } = require('chai');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const baseUrl = 'http://localhost:3000/';
  const randomToken = Date.now();
  const testEmail = `puppeteer_${randomToken}@test.com`;

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
    // Select country (US)
    await page.select('select[name="country"]', 'US');
    // Submit registration
    await page.click('#submit_registration');
    // Wait for success alert
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const regAlert = await page.$eval('div.alert', el => el.textContent);
    console.log('Registration alert:', regAlert.trim());
    expect(regAlert).to.match(/Registration is complete\.?/i);

    // 2. Go to add user page
    await page.goto(baseUrl + 'users/add/');
    await page.waitForSelector('#add_new_user_form');
    await page.type('#add_new_user_form input[name="name"]', 'PuppeteerFirst');
    await page.type('#add_new_user_form input[name="lastname"]', 'PuppeteerLast');
    await page.type('#add_new_user_form input[name="email_address"]', testEmail);
    await page.type('#add_new_user_form input[name="password_one"]', '123456789012');
    await page.type('#add_new_user_form input[name="password_confirm"]', '123456789012');
    // Select department (first option)
    const deptValue = await page.$eval('select[name="department"] option', el => el.value);
    await page.select('select[name="department"]', deptValue);
    await page.type('#add_new_user_form input[name="start_date"]', '2015-06-01');
    // Submit add user form
    await page.click('#add_new_user_btn');
    // Wait for error alert
    await page.waitForSelector('div.alert', { timeout: 10000 });
    const addUserAlert = await page.$eval('div.alert', el => el.textContent);
    console.log('Add user alert:', addUserAlert.trim());
    expect(addUserAlert).to.match(/Email is already in use/i);

    console.log('✅ Puppeteer add_new_user_with_existing_email test passed!');
  } catch (err) {
    console.error('❌ Puppeteer test failed:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();