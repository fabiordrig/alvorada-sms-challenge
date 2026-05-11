import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { validateTwilioSignature } from './webhook.signature.ts';

// Fixed test vectors — computed offline, not derived from the implementation.
// authToken=test-auth-token, url=https://example.com/webhook/sms
// params sorted: Body=Hello, From=+5511999000001, MessageSid=SM001
// data = url + "Body" + "Hello" + "From" + "+5511999000001" + "MessageSid" + "SM001"
// expected = base64(hmac-sha1(authToken, data))
const AUTH_TOKEN = 'test-auth-token';
const URL = 'https://example.com/webhook/sms';
const PARAMS = { Body: 'Hello', From: '+5511999000001', MessageSid: 'SM001' };
const VALID_SIG = crypto
  .createHmac('sha1', AUTH_TOKEN)
  .update(URL + 'BodyHelloFrom+5511999000001MessageSidSM001')
  .digest('base64');

describe('validateTwilioSignature', () => {
  it('returns true for valid HMAC-SHA1 signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, VALID_SIG)).toBe(true);
  });

  it('returns false for wrong signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, 'aW52YWxpZHNpZ25hdHVyZQ==')).toBe(false);
  });

  it('returns false when signature has different length than expected', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, 'short')).toBe(false);
  });
});
