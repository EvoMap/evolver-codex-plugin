import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withoutSecrets } from '../lib/redact.mjs';

test('environment-style names carrying a secret are redacted with their value', () => {
  for (const text of ['OPENAI_API_KEY=abcdef123456', 'MY_SECRET: hunter22hunter', 'export DB_PASSWORD="s3cr3t-value"', 'github-token=abcdefghij']) {
    const cleaned = withoutSecrets(text);
    assert.match(cleaned, /\[redacted\]/, text);
    assert.doesNotMatch(cleaned, /abcdef123456|hunter22hunter|s3cr3t-value|abcdefghij/, text);
  }
});

test('ordinary prose and short values are left alone', () => {
  for (const text of ['How do I rotate a token safely?', 'tokenizer: bpe', 'secret=abc']) assert.equal(withoutSecrets(text), text);
});

test('a quoted secret is redacted whole, spaces included', () => {
  const cleaned = withoutSecrets('export DB_PASSWORD="correct horse battery staple"');
  assert.doesNotMatch(cleaned, /horse|battery|staple/);
  assert.match(cleaned, /\[redacted\]/);
});

test('code identifiers that merely end in a secret word are left alone', () => {
  for (const text of ['const cancellationToken = controller.signal;', 'resetPassword = buildResetFlow(user)']) assert.equal(withoutSecrets(text), text);
});

test('a secret behind an unclosed quote is still redacted', () => {
  for (const text of ['API_KEY="abcdef123456', "TOKEN='abcdef123456"]) assert.doesNotMatch(withoutSecrets(text), /abcdef123456/, text);
});

test('a secret under a quoted JSON key is redacted', () => {
  for (const text of ['{"token":"abcdef123456"}', "{'api_key': 'abcdef123456'}", '{"client_secret" : "abcdef123456", "user": "ann"}']) {
    const cleaned = withoutSecrets(text);
    assert.doesNotMatch(cleaned, /abcdef123456/, text);
    assert.match(cleaned, /\[redacted\]/, text);
  }
  assert.match(withoutSecrets('{"client_secret" : "abcdef123456", "user": "ann"}'), /"user": "ann"/);
});

test('basic auth, cookies, curl credentials and a password flag are redacted; their words in prose are not', () => {
  const cases = {
    'curl -H "Authorization: Basic dXNlcjpodW50ZXIy" https://x': /dXNlcjpodW50ZXIy/,
    'Cookie: session=abc123def456; theme=dark': /abc123def456|theme=dark/,
    'curl -u ann:hunter22 https://x': /hunter22/,
    'curl --user=ann:hunter22 https://x': /hunter22/,
    'mysql --password hunter22hunter -h db': /hunter22hunter/,
    'deploy --api-key abcdef123456': /abcdef123456/,
  };
  for (const [text, secret] of Object.entries(cases)) assert.doesNotMatch(withoutSecrets(text), secret, text);
  assert.match(withoutSecrets('mysql --password hunter22hunter -h db'), /-h db$/);
  for (const text of ['Basic configuration of the uploader', 'The cookie banner is broken', 'Use -u to update']) {
    assert.equal(withoutSecrets(text), text);
  }
});

test('a quoted value after a password flag is redacted whole', () => {
  for (const text of ['mysql --password "correct horse battery" -h db', "deploy --token 'two words here'"]) {
    const cleaned = withoutSecrets(text);
    assert.doesNotMatch(cleaned, /horse|battery|words|here/, text);
  }
  assert.match(withoutSecrets('mysql --password "correct horse battery" -h db'), /-h db$/);
});
