import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { validateTwilioSignature } from './webhook.signature.ts';

const AUTH_TOKEN = 'test-auth-token';
const URL = 'https://example.com/api/webhook/sms';
const PARAMS = { Body: 'Hello', From: '+5511999000001', MessageSid: 'SM001' };

function buildExpectedSignature(token: string, url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  const paramString = sorted.reduce((acc, k) => acc + k + params[k], '');
  return crypto.createHmac('sha1', token).update(url + paramString).digest('base64');
}

describe('validateTwilioSignature', () => {
  it('returns true for valid HMAC-SHA1 signature', () => {
    const sig = buildExpectedSignature(AUTH_TOKEN, URL, PARAMS);
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, sig)).toBe(true);
  });

  it('returns false for wrong signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, 'invalidsignature==')).toBe(false);
  });
});
