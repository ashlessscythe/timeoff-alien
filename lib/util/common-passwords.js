'use strict'

// List of common passwords that should be rejected
// This is a small subset - in production you'd want a more comprehensive list
const commonPasswords = [
  'password',
  'password123',
  '123456',
  '12345678',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'root',
  'system',
  'test',
  'testing',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'abc123',
  '123abc',
  '111111',
  '000000',
  'iloveyou'
]

module.exports = commonPasswords
