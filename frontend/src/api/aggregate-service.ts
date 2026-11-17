import { listRows } from '../data/local-store'
import {
  listAggregateResults,
  listAggregateRuns,
  listOrders,
  listTruncatedGroups,
  saveAggregateResults,
  saveAggregateRuns,
  saveTruncatedGroups,
} from '../data/aggregate-store'
import { computeAggregation } from '../data/aggregate-engine'
import type {
  AggregateResultRow,
  AggregateRunRecord,
  ExecuteAggregateInput,
  ExecuteAggregateOutput,
  LateOrderPolicy,
  OrderRecord,
  ResultPage,
  ResultPageQuery,
  TruncatedGroupRow,
} from '../data/aggregate-types'
import type { EntryRow } from '../data/types'

/**
 * 聚合执行服务：页面只调这里，业务判断不进组件。
 *
 * 重试与并发语义：
 * - 同方案同窗口重复执行：按 (planId, windowId) 整体覆盖旧明细，绝不追加第二份同名分组；
 * - 并发重试：inFlight 互斥标记拦截，只保留一份聚合结果数据明细依据；
 * - 截断分组与结果明细同生共灭，截断组金额不进结果、不进结果导出。
 */

const inflight = new Set<string>()

function inflightKey(planId: number, windowId: string): string {
  return `${planId}|${windowId}`
}

/** 仅供验证脚本使用：读取互斥标记当前状态 */
export function isAggregateInFlight(planId: number, windowId: string): boolean {
  return inflight.has(inflightKey(planId, windowId))
}

/** 仅供验证脚本使用：模拟并发重试命中互斥标记的场景 */
export function __setInFlightForTest(planId: number, windowId: string, active: boolean): void {
  const key = inflightKey(planId, windowId)
  if (active) {
    inflight.add(key)
  } else {
    inflight.delete(key)
  }
}

function requirePlan(planId: number): EntryRow {
  const plan = listRows('aggregate').find((row) => Number(row.id) === Number(planId))
  if (!plan) {
    throw new Error(`没有找到编号为 ${planId} 的聚合方案`)
  }
  return plan
}

function nextRunId(runs: AggregateRunRecord[]): number {
  return runs.reduce((max, run) => Math.max(max, run.runId), 0) + 1
}

function newBatchId(planCode: string, windowId: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `BATCH-${planCode}-${windowId}-${stamp}`
}

/** 同步执行聚合（localStorage 写入是同步的，执行期间互斥标记不会被同线程打断） */
export function executeAggregate(input: ExecuteAggregateInput): ExecuteAggregateOutput {
  const plan = requirePlan(input.planId)
  const planCode = String(plan['方案编号'])
  const key = inflightKey(input.planId, input.windowId)

  // 并发重试：同方案同窗口已经在执行时，冲突直接忽略并留痕，不产生第二份明细
  if (inflight.has(key)) {
    const runs = listAggregateRuns()
    const conflictRun: AggregateRunRecord = {
      runId: nextRunId(runs),
      batchId: newBatchId(planCode, input.windowId),
      planId: input.planId,
      planCode,
      windowId: input.windowId,
      aggFunction: String(plan['聚合函数']),
      targetField: String(plan['目标字段']),
      groupField: String(plan['分组维度']),
      maxRows: input.maxRows,
      latePolicy: input.latePolicy,
      scannedCount: 0,
      includedCount: 0,
      lateCount: 0,
      resultCount: 0,
      truncatedCount: 0,
      boundaryBasis: '并发重试命中互斥标记，本次调用未读取订单原始记录',
      conflictBasis: `同方案同窗口（${key}）已有聚合在执行，冲突请求被忽略，沿用既有聚合结果数据明细，不追加同名分组`,
      outcome: '并发冲突忽略',
      executedAt: new Date().toISOString(),
    }
    saveAggregateRuns([...runs, conflictRun])
    return {
      ok: false,
      message: '同方案同窗口的聚合正在执行，并发重试已忽略，只保留一份聚合结果数据明细',
      batchId: conflictRun.batchId,
      run: conflictRun,
    }
  }

  inflight.add(key)
  try {
    const batchId = newBatchId(planCode, input.windowId)
    const executedAt = new Date().toISOString()
    const computed = computeAggregation(listOrders(), {
      plan: {
        id: input.planId,
        planCode,
        aggFunction: String(plan['聚合函数']),
        targetField: String(plan['目标字段']),
        groupField: String(plan['分组维度']),
        filterCondition: String(plan['筛选条件'] ?? ''),
        precisionText: String(plan['输出精度'] ?? ''),
      },
      windowId: input.windowId,
      maxRows: input.maxRows,
      policy: input.latePolicy,
      batchId,
      executedAt,
    })

    // 同方案同窗口整体覆盖：旧明细（含已不存在的分组）一并移除，保证每组只出现一次
    const keptResults = listAggregateResults().filter(
      (row) => !(row.planId === input.planId && row.windowId === input.windowId),
    )
    saveAggregateResults([...keptResults, ...computed.results])

    const keptTruncated = listTruncatedGroups().filter(
      (row) => !(row.planId === input.planId && row.windowId === input.windowId),
    )
    saveTruncatedGroups([...keptTruncated, ...computed.truncated])

    const runs = listAggregateRuns()
    const run: AggregateRunRecord = {
      runId: nextRunId(runs),
      batchId,
      planId: input.planId,
      planCode,
      windowId: input.windowId,
      aggFunction: String(plan['聚合函数']),
      targetField: String(plan['目标字段']),
      groupField: String(plan['分组维度']),
      maxRows: input.maxRows,
      latePolicy: input.latePolicy,
      scannedCount: computed.scannedCount,
      includedCount: computed.includedCount,
      lateCount: computed.lateCount,
      resultCount: computed.results.length,
      truncatedCount: computed.truncated.length,
      boundaryBasis: computed.boundaryBasis,
      conflictBasis: computed.conflictBasis,
      outcome: '执行成功',
      executedAt,
    }
    saveAggregateRuns([...runs, run])

    return {
      ok: true,
      message:
        `聚合完成：窗口 ${input.windowId} 写入 ${computed.results.length} 条结果明细` +
        (computed.truncated.length ? `，截断 ${computed.truncated.length} 个分组（不进入结果）` : '') +
        `，参与有效订单 ${computed.includedCount} 条，批次 ${batchId}`,
      batchId,
      run,
    }
  } finally {
    inflight.delete(key)
  }
}

/** 异步执行入口：先让出事件循环再执行，供页面与并发验证使用，互斥语义与同步入口一致 */
export async function executeAggregateAsync(input: ExecuteAggregateInput): Promise<ExecuteAggregateOutput> {
  await Promise.resolve()
  return executeAggregate(input)
}

// ---------------- 查询：排序、分页、翻页 ----------------

function matchesKeyword(row: AggregateResultRow, keyword: string): boolean {
  const word = keyword.trim()
  if (!word) {
    return true
  }
  return (
    row.groupKey.includes(word) ||
    row.planCode.includes(word) ||
    row.windowId.includes(word) ||
    row.orderIds.some((id) => id.includes(word))
  )
}

/** 聚合结果数据明细分页：筛选 + 排序 + 切片，排序/翻页后仍可用 orderIds 定位原记录 */
export function queryAggregateResults(query: ResultPageQuery): ResultPage {
  const all = listAggregateResults().filter((row) => {
    if (query.planId !== undefined && row.planId !== query.planId) {
      return false
    }
    if (query.windowId && row.windowId !== query.windowId) {
      return false
    }
    return matchesKeyword(row, query.keyword ?? '')
  })

  const direction = query.sortDirection === 'asc' ? 1 : -1
  const sorted = [...all].sort((a, b) => {
    const left = a[query.sortField]
    const right = b[query.sortField]
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * direction
    }
    return String(left).localeCompare(String(right), 'zh-Hans-CN') * direction
  })

  const size = Math.max(1, query.size)
  const totalPages = Math.max(1, Math.ceil(sorted.length / size))
  const page = Math.min(Math.max(1, query.page), totalPages)
  const start = (page - 1) * size
  return { items: sorted.slice(start, start + size), total: sorted.length, page, size }
}

export function listTruncatedGroupRows(planId?: number, windowId?: string): TruncatedGroupRow[] {
  return listTruncatedGroups().filter((row) => {
    if (planId !== undefined && row.planId !== planId) {
      return false
    }
    if (windowId && row.windowId !== windowId) {
      return false
    }
    return true
  })
}

export function listRunRecords(planId?: number): AggregateRunRecord[] {
  const rows = listAggregateRuns()
  return (planId === undefined ? rows : rows.filter((run) => run.planId === planId)).sort(
    (a, b) => b.runId - a.runId,
  )
}

/** 按订单编号回查原始记录，结果明细复核与下钻使用 */
export function findOrdersByIds(orderIds: string[]): OrderRecord[] {
  const orders = listOrders()
  return orderIds
    .map((id) => orders.find((order) => order.orderId === id))
    .filter((order): order is OrderRecord => Boolean(order))
}

export function availableWindows(): string[] {
  const months = new Set<string>()
  for (const order of listOrders()) {
    months.add(order.bizDate.slice(0, 7))
    months.add(order.postDate.slice(0, 7))
  }
  return [...months].sort()
}

// ---------------- 导出：入口与业务列表明细一致，结果写出下游 CSV 文件 ----------------

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(headers: string[], lines: (string | number)[][]): string {
  return `﻿${[headers, ...lines].map((line) => line.map(csvCell).join(',')).join('\n')}`
}
/** 聚合结果数据明细导出：补报金额单列，不会把补报金额悄悄混入旧窗口 */
export function exportAggregateResultCsv(planId?: number, windowId?: string): { filename: string; content: string } {
  const rows = listAggregateResults().filter((row) => {
    if (planId !== undefined && row.planId !== planId) {
      return false
    }
    if (windowId && row.windowId !== windowId) {
      return false
    }
    return true
  })
  const headers = [
    '方案编号', '聚合函数', '目标字段', '分组维度', '窗口标识', '分组取值',
    '聚合金额', '参与记录数', '常规金额', '补报金额', '补报记录数', '输出精度',
    '参与订单编号', '执行批次', '更新时间',
  ]
  const lines = rows.map((row) => [
    row.planCode, row.aggFunction, row.targetField, row.groupField, row.windowId, row.groupKey,
    row.aggAmount, row.recordCount, row.normalAmount, row.lateAmount, row.lateCount, row.precision,
    row.orderIds.join(';'), row.batchId, row.updatedAt,
  ])
  const suffix = windowId ? `-${windowId}` : ''
  return { filename: `聚合结果数据明细${suffix}.csv`, content: toCsv(headers, lines) }
}

/** 截断分组单独导出：带截断原因，不与结果金额混在同一文件 */
export function exportTruncatedCsv(planId?: number, windowId?: string): { filename: string; content: string } {
  const rows = listTruncatedGroupRows(planId, windowId)
  const headers = ['方案编号', '窗口标识', '分组取值', '聚合金额', '参与记录数', '截断原因', '执行批次']
  const lines = rows.map((row) => [
    row.planCode, row.windowId, row.groupKey, row.aggAmount, row.recordCount, row.truncateReason, row.batchId,
  ])
  const suffix = windowId ? `-${windowId}` : ''
  return { filename: `聚合截断分组${suffix}.csv`, content: toCsv(headers, lines) }
}

/** 执行依据导出：窗口边界与冲突判定依据，两种迟到处理做法可回看评估 */
export function exportRunRecordCsv(planId?: number): { filename: string; content: string } {
  const rows = listRunRecords(planId)
  const headers = [
    '执行序号', '执行批次', '方案编号', '窗口标识', '聚合函数', '目标字段', '分组维度',
    '最大输出行数', '迟到处理做法', '扫描候选数', '参与有效数', '补报订单数',
    '结果明细行数', '截断分组数', '窗口边界依据', '冲突判定依据', '执行结果', '执行时间',
  ]
  const lines = rows.map((row) => [
    row.runId, row.batchId, row.planCode, row.windowId, row.aggFunction, row.targetField, row.groupField,
    row.maxRows === null ? '不限' : row.maxRows, row.latePolicy, row.scannedCount, row.includedCount,
    row.lateCount, row.resultCount, row.truncatedCount, row.boundaryBasis, row.conflictBasis,
    row.outcome, row.executedAt,
  ])
  return { filename: '聚合执行依据.csv', content: toCsv(headers, lines) }
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export type { LateOrderPolicy }
