import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/client.ts', () => ({ db: { update: vi.fn(), insert: vi.fn() } }));
vi.mock('../../queue/index.ts', () => ({ connection: {} }));
vi.mock('../../services/events/sse.bus.ts', () => ({ sseBus: { emit: vi.fn() } }));
vi.mock('../../services/twilio/index.ts', () => ({ getTwilioClient: vi.fn() }));
vi.mock('../../lib/logger.ts', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('./processing.handler.ts', () => ({ generateReply: vi.fn() }));

import { processJob, attachWorkerEvents } from './processing.processor.ts';
import { db } from '../../db/client.ts';
import { sseBus } from '../../services/events/sse.bus.ts';
import { getTwilioClient } from '../../services/twilio/index.ts';
import { generateReply } from './processing.handler.ts';

const mockDb = db as { update: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
const mockBus = sseBus as { emit: ReturnType<typeof vi.fn> };
const mockGetClient = getTwilioClient as ReturnType<typeof vi.fn>;
const mockGenerateReply = generateReply as ReturnType<typeof vi.fn>;

const BASE_JOB_DATA = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  inboundBody: 'Hello',
  fromNumber: '+5511999000001',
};

function makeJob(data = BASE_JOB_DATA, attemptsMade = 1, attempts = 3) {
  return { data, attemptsMade, opts: { attempts } } as any;
}

function buildUpdateChain() {
  const chain = { set: vi.fn(), where: vi.fn() };
  chain.set.mockReturnValue(chain);
  chain.where.mockResolvedValue([]);
  return chain;
}

function buildInsertChain() {
  const chain = { values: vi.fn().mockResolvedValue([]) };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateReply.mockResolvedValue('Echo: Hello');
  mockGetClient.mockReturnValue({ sendMessage: vi.fn().mockResolvedValue('SM_mock_sid') });
  mockDb.update.mockImplementation(() => buildUpdateChain());
  mockDb.insert.mockImplementation(() => buildInsertChain());
});

describe('processJob', () => {
  it('happy path: status → processing → sent, SSE emitted, Twilio called', async () => {
    const sendMessage = vi.fn().mockResolvedValue('SM_real_sid');
    mockGetClient.mockReturnValue({ sendMessage });

    await processJob(makeJob());

    // status progression: update × 3 (processing, inbound sent, conv updatedAt)
    expect(mockDb.update).toHaveBeenCalledTimes(3);

    // outbound message inserted after Twilio confirms
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const insertChain = mockDb.insert.mock.results[0].value;
    const insertedRow = insertChain.values.mock.calls[0][0];
    expect(insertedRow.direction).toBe('outbound');
    expect(insertedRow.status).toBe('sent');
    expect(insertedRow.twilioSid).toBe('SM_real_sid');

    expect(sendMessage).toHaveBeenCalledWith('+5511999000001', 'Echo: Hello');

    expect(mockBus.emit).toHaveBeenCalledWith('message:processing', expect.objectContaining({ messageId: 'msg-1', status: 'processing' }));
    expect(mockBus.emit).toHaveBeenCalledWith('message:sent', expect.objectContaining({ messageId: 'msg-1', status: 'sent' }));
  });

  it('Twilio failure: marks inbound as failed, emits SSE failed, re-throws, no outbound inserted', async () => {
    const twilioError = new Error('Twilio 500');
    mockGetClient.mockReturnValue({ sendMessage: vi.fn().mockRejectedValue(twilioError) });

    await expect(processJob(makeJob())).rejects.toThrow('Twilio 500');

    // insert must NOT have been called (no orphan outbound message)
    expect(mockDb.insert).not.toHaveBeenCalled();

    // last update call must set status failed
    const updateCalls = mockDb.update.mock.results.map((r: any) => r.value.set.mock.calls[0]?.[0]);
    const failedUpdate = updateCalls.find((c: any) => c?.status === 'failed');
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate.error).toBe('Twilio 500');

    expect(mockBus.emit).toHaveBeenCalledWith('message:failed', expect.objectContaining({ messageId: 'msg-1', status: 'failed' }));
  });

  it('simulated failure phone +5511999000003 throws before any DB call', async () => {
    const data = { ...BASE_JOB_DATA, fromNumber: '+5511999000003' };

    await expect(processJob(makeJob(data))).rejects.toThrow('Simulated failure');

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockBus.emit).not.toHaveBeenCalled();
  });
});

describe('attachWorkerEvents — failed handler', () => {
  it('last attempt: marks message failed + emits SSE', async () => {
    const fakeWorker = { on: vi.fn() } as any;
    attachWorkerEvents(fakeWorker);

    const [event, handler] = fakeWorker.on.mock.calls[0];
    expect(event).toBe('failed');

    const job = makeJob(BASE_JOB_DATA, 3, 3); // attemptsMade === attempts → last attempt
    await handler(job, new Error('dead-letter reason'));

    const updateCalls = mockDb.update.mock.results.map((r: any) => r.value.set.mock.calls[0]?.[0]);
    const failedUpdate = updateCalls.find((c: any) => c?.status === 'failed');
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate.error).toBe('dead-letter reason');

    expect(mockBus.emit).toHaveBeenCalledWith('message:failed', expect.objectContaining({ messageId: 'msg-1', status: 'failed' }));
  });

  it('non-last attempt: no DB update, no SSE', async () => {
    const fakeWorker = { on: vi.fn() } as any;
    attachWorkerEvents(fakeWorker);

    const [, handler] = fakeWorker.on.mock.calls[0];
    const job = makeJob(BASE_JOB_DATA, 1, 3); // attemptsMade < attempts → retry, not last
    await handler(job, new Error('transient error'));

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockBus.emit).not.toHaveBeenCalled();
  });
});
