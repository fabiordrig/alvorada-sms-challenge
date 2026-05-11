import crypto from 'crypto';

export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.reduce((acc, key) => acc + key + params[key], '');
  const data = url + paramString;
  const expected = crypto.createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
