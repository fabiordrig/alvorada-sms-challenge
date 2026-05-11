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
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
