import { vi } from 'vitest';
import type { Experiment, ExperimentBlock } from '@/lib/types';

type RpcResult = { data: unknown; error: unknown };
type RpcHandler = (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

export interface MockDb {
  experiment: Experiment;
  blocks: ExperimentBlock[];
  rpcHandlers: Record<string, RpcHandler>;
  fromCalls: string[];
}

export const db: MockDb = {
  experiment: {} as Experiment,
  blocks: [],
  rpcHandlers: {},
  fromCalls: [],
};

export const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  const handler = db.rpcHandlers[name];
  return handler ? handler(args) : { data: null, error: null };
});

function resultFor(table: string, mode: 'many' | 'single' | 'maybeSingle'): RpcResult {
  switch (table) {
    case 'experiments':
      return mode === 'maybeSingle'
        ? { data: { metadata_version: db.experiment.metadata_version }, error: null }
        : { data: JSON.parse(JSON.stringify(db.experiment)), error: null };
    case 'experiment_blocks':
      return { data: JSON.parse(JSON.stringify(db.blocks)), error: null };
    case 'favorites':
      return { data: mode === 'many' ? [] : null, error: null };
    default:
      return { data: [], error: null };
  }
}

function chain(table: string) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in', 'or', 'gte', 'lte', 'range', 'limit', 'insert', 'delete']) {
    builder[m] = () => builder;
  }
  builder.single = async () => resultFor(table, 'single');
  builder.maybeSingle = async () => resultFor(table, 'maybeSingle');
  builder.then = (resolve: (r: RpcResult) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resultFor(table, 'many')).then(resolve, reject);
  return builder;
}

export const supabaseMock = {
  rpc,
  from: vi.fn((table: string) => {
    db.fromCalls.push(table);
    return chain(table);
  }),
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
};

export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

export async function settle() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

export function rpcCalls(name: string): Record<string, unknown>[] {
  return rpc.mock.calls.filter(([n]) => n === name).map(([, args]) => args);
}

export function makeBlock(id: string, overrides: Partial<ExperimentBlock> = {}): ExperimentBlock {
  return {
    id,
    experiment_id: 'exp-1',
    type: 'paragraph',
    content: { html: `${id} server` },
    order_key: `a${id.slice(-1)}`,
    row_version: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ExperimentBlock;
}

export function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-1',
    workspace_id: 'ws-1',
    notebook_id: 'nb-1',
    folder_id: null,
    title: 'Original title',
    experiment_date: '2024-01-01',
    status: 'in_progress',
    is_locked: false,
    is_archived: false,
    metadata_version: 5,
    ...overrides,
  } as Experiment;
}

export function resetDb() {
  db.experiment = makeExperiment();
  db.blocks = [makeBlock('b1'), makeBlock('b2')];
  db.rpcHandlers = {};
  db.fromCalls = [];
  rpc.mockClear();
}
