import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/client.ts', () => ({ db: { transaction: vi.fn() } }));
vi.mock('../../queue/index.ts', () => ({ smsQueue: { add: vi.fn() } }));
vi.mock('../../services/events/sse.bus.ts', () => ({ sseBus: { emit: vi.fn() } }));
vi.mock('../../lib/logger.ts', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { handleInbound } from './webhook.service';
import { db } from '../../db/client';
import { smsQueue } from '../../queue/index';
import { sseBus } from '../../services/events/sse.bus';

const mockDb = db as { transaction: ReturnType<typeof vi.fn> };
const mockQueue = smsQueue as { add: ReturnType<typeof vi.fn> };
const mockBus = sseBus as { emit: ReturnType<typeof vi.fn> };

function makeTx(convId: string, msgId: string | null) {
  const buildChain = (result: unknown[]) => {
    const chain: Record<string, () => unknown> = {};
    chain.values = () => chain;
    chain.onConflictDoUpdate = () => chain;
    chain.onConflictDoNothing = () => chain;
    chain.returning = () => Promise.resolve(result);
    return chain;
  };

  return {
    insert: vi.fn()
      .mockReturnValueOnce(buildChain([{ id: convId }]))
      .mockReturnValueOnce(buildChain(msgId ? [{ id: msgId }] : [])),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleInbound', () => {
  it('happy path: new conv + new msg → enqueue + emit', async () => {
    const convId = 'conv-1';
    const msgId = 'msg-1';
    const tx = makeTx(convId, msgId);
    mockDb.transaction.mockImplementation((cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await handleInbound({ from: '+5511999000001', body: 'Hello', messageSid: 'SM001' });

    expect(result.duplicate).toBe(false);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ messageId: msgId, conversationId: convId }),
      { jobId: msgId },
    );
    expect(mockBus.emit).toHaveBeenCalledWith('message:received', expect.objectContaining({ messageId: msgId }));
  });

  it('idempotency: duplicate MessageSid → no enqueue, no emit', async () => {
    const tx = makeTx('conv-1', null);
    mockDb.transaction.mockImplementation((cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await handleInbound({ from: '+5511999000001', body: 'Hello', messageSid: 'SM001' });

    expect(result.duplicate).toBe(true);
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockBus.emit).not.toHaveBeenCalled();
  });

  it('same phone, new message → creates new msg under existing conv', async () => {
    const convId = 'conv-1';
    const msgId = 'msg-2';
    const tx = makeTx(convId, msgId);
    mockDb.transaction.mockImplementation((cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await handleInbound({ from: '+5511999000001', body: 'Second message', messageSid: 'SM002' });

    expect(result.duplicate).toBe(false);
    expect(mockQueue.add).toHaveBeenCalledWith('process', expect.objectContaining({ conversationId: convId }), { jobId: msgId });
  });

  it('jobId equals messageId', async () => {
    const msgId = 'msg-abc-123';
    const tx = makeTx('conv-x', msgId);
    mockDb.transaction.mockImplementation((cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

    await handleInbound({ from: '+1234567890', body: 'test', messageSid: 'SM999' });

    const callArgs = mockQueue.add.mock.calls[0];
    expect(callArgs[2]).toEqual({ jobId: msgId });
    expect(callArgs[1].messageId).toBe(msgId);
  });
});
