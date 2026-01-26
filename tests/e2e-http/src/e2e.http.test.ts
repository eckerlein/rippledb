import http from 'node:http';
import { createReplicator } from '@rippledb/client';
import { createHlcState, makeDelete, makeUpsert, tickHlc } from '@rippledb/core';
import { MemoryDb } from '@rippledb/db-memory';
import { createHttpRemote } from '@rippledb/remote-http';
import { MemoryStore } from '@rippledb/store-memory';
import { describe, expect, it } from 'vitest';

type DemoSchema = {
  todo: { id: string; title: string };
};

function makeHlc(nodeId: string, nowMs: number) {
  const state = createHlcState(nodeId);
  return tickHlc(state, nowMs);
}

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length ? JSON.parse(raw) : {};
}

function startServer(db: MemoryDb<DemoSchema>) {
  const server = http.createServer(async (req, res) => {
    if (!req.url || req.method !== 'POST') {
      res.statusCode = 404;
      return res.end();
    }

    if (req.url === '/append') {
      const body = await readJson(req);
      const result = await db.append(body);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(result));
    }

    if (req.url === '/pull') {
      const body = await readJson(req);
      const result = await db.pull(body);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(result));
    }

    res.statusCode = 404;
    return res.end();
  });

  return new Promise<{ server: http.Server; baseUrl: string }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Invalid server address'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('converge http e2e (memory db server + http remote)', () => {
  it('syncs over HTTP with two clients', async () => {
    const db = new MemoryDb<DemoSchema>();
    const { server, baseUrl } = await startServer(db);

    try {
      const remote = createHttpRemote<DemoSchema>({ baseUrl });
      const storeA = new MemoryStore<DemoSchema>();
      const storeB = new MemoryStore<DemoSchema>();
      const replA = createReplicator({ stream: 'demo', store: storeA, remote });
      const replB = createReplicator({ stream: 'demo', store: storeB, remote });

      const c1 = makeUpsert<DemoSchema>({
        stream: 'demo',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'hello' },
        hlc: makeHlc('a', 1000),
      });
      await replA.pushLocal(c1);
      await replA.sync();
      await replB.sync();
      expect(await storeB.getRow('todo', '1')).toMatchObject({ id: '1', title: 'hello' });

      const c2 = makeUpsert<DemoSchema>({
        stream: 'demo',
        entity: 'todo',
        entityId: '1',
        patch: { title: 'bye' },
        hlc: makeHlc('b', 2000),
      });
      await replB.pushLocal(c2);
      await replB.sync();
      await replA.sync();
      expect(await storeA.getRow('todo', '1')).toMatchObject({ id: '1', title: 'bye' });

      const c3 = makeDelete<DemoSchema>({
        stream: 'demo',
        entity: 'todo',
        entityId: '1',
        hlc: makeHlc('a', 3000),
      });
      await replA.pushLocal(c3);
      await replA.sync();
      await replB.sync();
      expect(await storeB.getRow('todo', '1')).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

