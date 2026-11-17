import { SEED_ORDERS } from './order-seed'
import type {
  AggregateResultRow,
  AggregateRunRecord,
  OrderRecord,
  TruncatedGroupRow,
} from './aggregate-types'

/**
 * 聚合执行链路的本地持久化。
 *
 * 与 local-store.ts 的业务条目分开存放，各自独立 key：
 * - 订单原始记录只读播种；
 * - 聚合结果数据明细、截断分组、执行依据全部落 localStorage，刷新/重开浏览器仍可回看。
 *
 * Node 验证环境（无 window）下自动退化为内存存储，同一进程内可模拟「刷新」。
 */

const ORDERS_KEY = 'data-explore-studio:orders'
const RESULTS_KEY = 'data-explore-studio:aggregate-results'
const TRUNCATED_KEY = 'data-explore-studio:aggregate-truncated'
const RUNS_KEY = 'data-explore-studio:aggregate-runs'
const VIEW_KEY = 'data-explore-studio:aggregate-view'

const memory = new Map<string, unknown>()

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readJson<T>(key: string, fallback: T): T {
  if (hasStorage()) {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      window.localStorage.setItem(key, JSON.stringify(fallback))
      return fallback
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      window.localStorage.setItem(key, JSON.stringify(fallback))
      return fallback
    }
  }
  const mem = memory.get(key)
  return mem === undefined ? fallback : (mem as T)
}

function writeJson<T>(key: string, value: T): void {
  if (hasStorage()) {
    window.localStorage.setItem(key, JSON.stringify(value))
  } else {
    memory.set(key, value)
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 仅供 Node 验证脚本使用：清空内存存储，模拟全新打开应用 */
export function __resetAggregateMemoryForTest(): void {
  memory.clear()
}

// ---------------- 订单原始记录 ----------------

export function listOrders(): OrderRecord[] {
  return readJson<OrderRecord[]>(ORDERS_KEY, clone(SEED_ORDERS))
}

// ---------------- 聚合结果数据明细 ----------------

export function listAggregateResults(): AggregateResultRow[] {
  return readJson<AggregateResultRow[]>(RESULTS_KEY, [])
}

export function saveAggregateResults(rows: AggregateResultRow[]): void {
  writeJson(RESULTS_KEY, rows)
}

// ---------------- 截断分组 ----------------

export function listTruncatedGroups(): TruncatedGroupRow[] {
  return readJson<TruncatedGroupRow[]>(TRUNCATED_KEY, [])
}

export function saveTruncatedGroups(rows: TruncatedGroupRow[]): void {
  writeJson(TRUNCATED_KEY, rows)
}

// ---------------- 执行依据 ----------------

export function listAggregateRuns(): AggregateRunRecord[] {
  return readJson<AggregateRunRecord[]>(RUNS_KEY, [])
}

export function saveAggregateRuns(rows: AggregateRunRecord[]): void {
  writeJson(RUNS_KEY, rows)
}

// ---------------- 结果页视图状态（排序/分页/筛选，翻页后仍可定位） ----------------

export type AggregateViewState = {
  keyword: string
  windowFilter: string
  sortField: string
  sortDirection: 'asc' | 'desc'
  page: number
  size: number
}

const DEFAULT_VIEW_STATE: AggregateViewState = {
  keyword: '',
  windowFilter: '',
  sortField: 'aggAmount',
  sortDirection: 'desc',
  page: 1,
  size: 8,
}

export function loadViewState(): AggregateViewState {
  return readJson<AggregateViewState>(VIEW_KEY, { ...DEFAULT_VIEW_STATE })
}

export function saveViewState(state: AggregateViewState): void {
  writeJson(VIEW_KEY, state)
}
