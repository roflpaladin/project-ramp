// Sprint 12, Ticket 62 — shared in-memory stand-in for the service-role
// Supabase client, for the DB-FREE buyer-gate specs in this folder.
//
// The existing fakes (tests/security/portal-session-cookie.spec.ts,
// tests/api/waitlist.spec.ts) answer every query on a table with ONE
// pre-configured `{ data, error }`, which is enough to pin a cookie's options
// or a route's status code. This ticket's behaviour is about STATE ACROSS
// CALLS — attempts incrementing on one row, a sum of attempts across several
// rows, consumed_at being written and then blocking a replay, a resend
// cooldown reading back a row the previous call inserted — so a
// single-canned-answer fake cannot express it. This one keeps real rows in
// memory and applies the filters/ordering the code under test actually asks
// for.
//
// Deliberately supports only the query surface lib/portal-access-token.ts and
// app/portal/[id]/gate-actions.ts use (select/eq/is/gte/order/limit/
// maybeSingle/single, insert, update+eq). Anything else is a missing method,
// which fails loudly rather than silently returning an empty result.
//
// Rows are never mutated in place: an update rebuilds the table's array with
// new row objects, so a snapshot taken by a test stays a snapshot.

import { randomUUID } from "node:crypto";

export interface FakeRow {
  readonly [column: string]: unknown;
}

export type FakeOperation = "select" | "insert" | "update";

export interface RecordedCall {
  readonly table: string;
  readonly operation: FakeOperation;
}

export interface FakeAdminDb {
  /** Drop-in for `createAdminClient()`'s return value. */
  readonly client: { from(table: string): FakeQueryBuilder };
  /** Every terminal query this fake actually executed, in order. */
  readonly calls: readonly RecordedCall[];
  rowsOf(table: string): readonly FakeRow[];
  seed(table: string, rows: readonly FakeRow[]): void;
  /**
   * T62 code review: makes the NEXT terminal query on `table` with that
   * `operation` answer `{ data: null, error }` instead of running, so the
   * fail-closed branches in lib/portal-access-token.ts can be exercised.
   * One-shot: cleared as soon as it fires.
   */
  failNext(table: string, operation: FakeOperation): void;
  reset(): void;
}

type RowPredicate = (row: FakeRow) => boolean;

interface QueryState {
  readonly table: string;
  readonly predicates: readonly RowPredicate[];
  readonly orderColumn: string | null;
  readonly ascending: boolean;
  readonly limitCount: number | null;
}

interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

export interface FakeQueryBuilder {
  select(columns?: string): FakeQueryBuilder;
  eq(column: string, value: unknown): FakeQueryBuilder;
  is(column: string, value: unknown): FakeQueryBuilder;
  gte(column: string, value: unknown): FakeQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): FakeQueryBuilder;
  limit(count: number): FakeQueryBuilder;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
  insert(payload: FakeRow | readonly FakeRow[]): PromiseLike<QueryResult>;
  update(patch: FakeRow): FakeUpdateBuilder;
  then(resolve: (value: QueryResult) => void): void;
}

export interface FakeUpdateBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): FakeUpdateBuilder;
}

function compareByColumn(column: string, ascending: boolean): (a: FakeRow, b: FakeRow) => number {
  return (a, b) => {
    const left = String(a[column] ?? "");
    const right = String(b[column] ?? "");
    if (left === right) return 0;
    const order = left < right ? -1 : 1;
    return ascending ? order : -order;
  };
}

/**
 * `tableDefaults` mirrors the SQL column defaults the real table has
 * (supabase/migrations/0002_portal_access_tokens.sql: `attempts` defaults to
 * 0, `consumed_at` to NULL) — without them an inserted row would be missing
 * columns the real code legitimately reads back.
 */
export function createFakeAdminDb(
  tableDefaults: Readonly<Record<string, FakeRow>> = {},
): FakeAdminDb {
  const tables = new Map<string, readonly FakeRow[]>();
  const calls: RecordedCall[] = [];

  const rowsOf = (table: string): readonly FakeRow[] => tables.get(table) ?? [];

  let pendingFailure: { table: string; operation: FakeOperation } | null = null;

  function record(table: string, operation: FakeOperation): void {
    calls.push({ table, operation });
  }

  /** True (and consumes the switch) when this query was told to fail. */
  function takeFailure(table: string, operation: FakeOperation): boolean {
    if (!pendingFailure || pendingFailure.table !== table || pendingFailure.operation !== operation) {
      return false;
    }
    pendingFailure = null;
    return true;
  }

  const INJECTED_ERROR = { message: "injected failure (tests/portal/support)" };

  function runQuery(state: QueryState): readonly FakeRow[] {
    const matched = rowsOf(state.table).filter((row) => state.predicates.every((test) => test(row)));
    const ordered = state.orderColumn
      ? [...matched].sort(compareByColumn(state.orderColumn, state.ascending))
      : matched;
    return state.limitCount === null ? ordered : ordered.slice(0, state.limitCount);
  }

  function insertInto(table: string, payload: FakeRow | readonly FakeRow[]): void {
    const incoming = Array.isArray(payload) ? payload : [payload as FakeRow];
    const prepared = incoming.map((row) => ({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      ...tableDefaults[table],
      ...row,
    }));
    tables.set(table, [...rowsOf(table), ...prepared]);
  }

  function updateIn(state: QueryState, patch: FakeRow): void {
    const next = rowsOf(state.table).map((row) =>
      state.predicates.every((test) => test(row)) ? { ...row, ...patch } : row,
    );
    tables.set(state.table, next);
  }

  function updateBuilder(state: QueryState, patch: FakeRow): FakeUpdateBuilder {
    const builder: FakeUpdateBuilder = {
      eq: (column, value) =>
        updateBuilder(
          { ...state, predicates: [...state.predicates, (row) => row[column] === value] },
          patch,
        ),
      then: (resolve) => {
        record(state.table, "update");
        if (takeFailure(state.table, "update")) {
          return Promise.resolve({ data: null, error: INJECTED_ERROR }).then(resolve);
        }
        updateIn(state, patch);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  }

  function queryBuilder(state: QueryState): FakeQueryBuilder {
    const withPredicate = (test: RowPredicate): FakeQueryBuilder =>
      queryBuilder({ ...state, predicates: [...state.predicates, test] });

    return {
      select: () => queryBuilder(state),
      eq: (column, value) => withPredicate((row) => row[column] === value),
      is: (column, value) => withPredicate((row) => (row[column] ?? null) === value),
      gte: (column, value) => withPredicate((row) => String(row[column] ?? "") >= String(value)),
      order: (column, options) =>
        queryBuilder({ ...state, orderColumn: column, ascending: options?.ascending !== false }),
      limit: (count) => queryBuilder({ ...state, limitCount: count }),
      maybeSingle: async () => {
        record(state.table, "select");
        if (takeFailure(state.table, "select")) return { data: null, error: INJECTED_ERROR };
        return { data: runQuery(state)[0] ?? null, error: null };
      },
      single: async () => {
        record(state.table, "select");
        const row = runQuery(state)[0] ?? null;
        return row
          ? { data: row, error: null }
          : { data: null, error: { message: "no rows returned" } };
      },
      insert: (payload) => ({
        then: (resolve) => {
          record(state.table, "insert");
          insertInto(state.table, payload);
          return Promise.resolve({ data: null, error: null } as QueryResult).then(resolve);
        },
      }),
      update: (patch) => updateBuilder(state, patch),
      then: (resolve) => {
        record(state.table, "select");
        if (takeFailure(state.table, "select")) {
          resolve({ data: null, error: INJECTED_ERROR });
          return;
        }
        resolve({ data: runQuery(state), error: null });
      },
    };
  }

  return {
    client: {
      from: (table: string) =>
        queryBuilder({ table, predicates: [], orderColumn: null, ascending: true, limitCount: null }),
    },
    calls,
    rowsOf,
    seed: (table, rows) => {
      tables.set(table, [...rowsOf(table), ...rows]);
    },
    failNext: (table, operation) => {
      pendingFailure = { table, operation };
    },
    reset: () => {
      tables.clear();
      calls.length = 0;
      pendingFailure = null;
    },
  };
}
