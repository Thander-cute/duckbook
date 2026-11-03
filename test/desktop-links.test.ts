import assert from 'node:assert/strict'
import test from 'node:test'
import { opensOutside } from '../desktop/links.ts'

test('only Google sign-in and Duckbook’s privacy pages leave the desktop app', () => {
  for (const url of ['https://accounts.google.com/o/oauth2/v2/auth?client_id=x', 'https://duckbook.khoadev.id.vn/privacy', 'https://duckbook.khoadev.id.vn/terms']) assert.ok(opensOutside(url), url)
  for (const url of [
    'https://example.com/',
    'http://accounts.google.com/',
    'https://accounts.google.com.evil.example/',
    'https://evil.example/?https://accounts.google.com/',
    'https://user:pass@accounts.google.com/',
    'https://duckbook.khoadev.id.vn.evil.example/',
    'http://duckbook.khoadev.id.vn/privacy',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'not a url',
  ])
    assert.equal(opensOutside(url), false, url)
})
