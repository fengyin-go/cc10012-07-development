import type {
  AggregateRunRecord,
  LateOrderPolicy,
  OrderRecord,
  TruncatedGroupRow,
} from './aggregate-types'
import type { AggregateResultRow } from './aggregate-types'

/**
 * 聚合执行引擎：纯函数，不碰 localStorage / DOM，Node 验证脚本可直接调用。
 *
 * 关键约束（对应需求）：
 * 1. 时间窗口边界：按业务月与入账月双重判定，迟到订单在「双窗口保留」做法下
 *    同时落在已完成窗口和下一窗口，两个业务窗口都可能成立；
 * 2. 最大输出行数：截断的分组只进截断清单、绝不进入结果，导出不会重复累计金额；
 * 3. 每个分组只产出一条明细（resultKey = 方案+窗口+分组），重试覆盖而非追加；
 * 4. 明细保留窗口标识、参与记录数、补报记录数与补报金额，冲突判定全部留文字依据。
 */

export const VALID_ORDER_STATUS = '有效'

const FIELD_ACCESSORS: Record<string, (order: OrderRecord) => string | number> = {
  区域: (o) => o.region,
  商品品类: (o) => o.category,
  渠道: (o) => o.channel,
  状态: (o) => o.status,
  金额: (o) => o.amount,
}

export function monthOf(dateText: string): string {
  return dateText.slice(0, 7)
}

/** 从方案「输出精度」文本解析小数位，如「2位小数」→ 2，无法识别时回退 2 */
export function parsePrecision(text: string): number {
  const matched = /(\d+)/.exec(String(text ?? ''))
  if (!matched) {
    return 2
  }
  const value = Number(matched[1])
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 6) : 2
}

/** 解析方案「筛选条件」，支持「字段=值;字段=值」，识别不了的条件原样忽略并在依据中体现 */
export function parseFilterCondition(text: string): { field: string; value: string }[] {
  return String(text ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field = '', value = ''] = part.split('=').map((s) => s.trim())
      return { field, value }
    })
    .filter((item) => item.field && FIELD_ACCESSORS[item.field] !== undefined)
}

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export type WindowMembership = {
  order: OrderRecord
  /** 在当前窗口内是否按补报（迟到）订单处理 */
  isLate: boolean
  /** 窗口边界判定依据 */
  basis: string
}

/**
 * 计算窗口候选订单及迟到标记。
 * - 业务月命中：订单天然属于该业务窗口；若入账月晚于业务月，它对已完成窗口是补报；
 * - 入账月命中且入账月更晚：迟到订单落入下一窗口；
 * - 「仅业务窗口」做法直接排除入账月副本，补报金额不会进入下一窗口。
 */
export function windowCandidates(
  orders: OrderRecord[],
  windowId: string,
  policy: LateOrderPolicy,
): WindowMembership[] {
  const members: WindowMembership[] = []
  for (const order of orders) {
    const bizMonth = monthOf(order.bizDate)
    const postMonth = monthOf(order.postDate)
    const reportedLate = postMonth > bizMonth

    if (bizMonth === windowId) {
      members.push({
        order,
        isLate: reportedLate,
        basis: reportedLate
          ? `业务月${bizMonth}命中窗口，入账月${postMonth}晚于业务月，按补报订单保留在已完成窗口`
          : `业务月${bizMonth}命中窗口，业务月内入账，常规订单`,
      })
      continue
    }

    if (policy === '双窗口保留' && postMonth === windowId && reportedLate) {
      members.push({
        order,
        isLate: true,
        basis: `业务月${bizMonth}早于窗口${windowId}，入账月${postMonth}命中下一窗口，双窗口保留做法下计入补报`,
      })
    }
  }
  return members
}

type GroupBucket = {
  groupKey: string
  orderIds: string[]
  lateOrderIds: string[]
  normalAmount: number
  lateAmount: number
  amountValues: number[]
}

function applyFilters(order: OrderRecord, filters: { field: string; value: string }[]): boolean {
  return filters.every(({ field, value }) => String(FIELD_ACCESSORS[field](order)) === value)
}

export type AggregationComputed = {
  results: AggregateResultRow[]
  truncated: TruncatedGroupRow[]
  scannedCount: number
  includedCount: number
  lateCount: number
  boundaryBasis: string
  conflictBasis: string
}

type PlanLike = {
  id: number
  planCode: string
  aggFunction: string
  targetField: string
  groupField: string
  filterCondition: string
  precisionText: string
}

type RunOptions = {
  plan: PlanLike
  windowId: string
  maxRows: number | null
  policy: LateOrderPolicy
  batchId: string
  executedAt: string
}

/**
 * 执行一次聚合计算，返回「结果明细 + 截断分组 + 判定依据」。
 * 本函数不做持久化：重试覆盖、并发互斥由 aggregate-service 负责。
 */
export function computeAggregation(orders: OrderRecord[], options: RunOptions): AggregationComputed {
  const { plan, windowId, maxRows, policy, batchId, executedAt } = options
  const precision = parsePrecision(plan.precisionText)
  const filters = parseFilterCondition(plan.filterCondition)

  const candidates = windowCandidates(orders, windowId, policy)
  const scannedCount = candidates.length
  const included = candidates.filter(
    ({ order }) => order.status === VALID_ORDER_STATUS && applyFilters(order, filters),
  )
  const lateCount = included.filter(({ isLate }) => isLate).length

  const buckets = new Map<string, GroupBucket>()
  for (const { order, isLate } of included) {
    const accessor = FIELD_ACCESSORS[plan.groupField]
    const groupValue = accessor ? String(accessor(order)) : String((order as unknown as Record<string, unknown>)[plan.groupField] ?? '未知分组')
    const groupKey = `${plan.groupField}=${groupValue}`
    let bucket = buckets.get(groupKey)
    if (!bucket) {
      bucket = {
        groupKey,
        orderIds: [],
        lateOrderIds: [],
        normalAmount: 0,
        lateAmount: 0,
        amountValues: [],
      }
      buckets.set(groupKey, bucket)
    }
    bucket.orderIds.push(order.orderId)
    bucket.amountValues.push(order.amount)
    if (isLate) {
      bucket.lateOrderIds.push(order.orderId)
      bucket.lateAmount += order.amount
    } else {
      bucket.normalAmount += order.amount
    }
  }

  const aggFunction = plan.aggFunction.toUpperCase()
  const allGroups = [...buckets.values()].map((bucket) => {
    const recordCount = bucket.orderIds.length
    let aggAmount: number
    switch (aggFunction) {
      case 'COUNT':
        aggAmount = recordCount
        break
      case 'AVG':
        aggAmount = recordCount === 0 ? 0 : bucket.amountValues.reduce((sum, v) => sum + v, 0) / recordCount
        break
      case 'MAX':
        aggAmount = recordCount === 0 ? 0 : Math.max(...bucket.amountValues)
        break
      case 'MIN':
        aggAmount = recordCount === 0 ? 0 : Math.min(...bucket.amountValues)
        break
      case 'SUM':
      default:
        aggAmount = bucket.normalAmount + bucket.lateAmount
        break
    }
    return {
      bucket,
      recordCount,
      aggAmount: roundTo(aggAmount, precision),
      normalAmount: roundTo(bucket.normalAmount, precision),
      lateAmount: roundTo(bucket.lateAmount, precision),
    }
  })

  // 统一排序口径：聚合金额降序，金额相同按分组名升序。截断与展示共用，保证可复核。
  const ranked = [...allGroups].sort((a, b) => {
    if (b.aggAmount !== a.aggAmount) {
      return b.aggAmount - a.aggAmount
    }
    return a.bucket.groupKey.localeCompare(b.bucket.groupKey, 'zh-Hans-CN')
  })

  const limit = maxRows !== null && maxRows > 0 ? maxRows : ranked.length
  const kept = ranked.slice(0, limit)
  const cut = ranked.slice(limit)

  const results: AggregateResultRow[] = kept.map(({ bucket, recordCount, aggAmount, normalAmount, lateAmount }) => ({
    resultKey: `${plan.planCode}|${windowId}|${bucket.groupKey}`,
    planId: plan.id,
    planCode: plan.planCode,
    aggFunction: plan.aggFunction,
    targetField: plan.targetField,
    groupField: plan.groupField,
    windowId,
    groupKey: bucket.groupKey,
    aggAmount,
    recordCount,
    lateCount: bucket.lateOrderIds.length,
    lateAmount,
    normalAmount,
    precision,
    orderIds: [...bucket.orderIds],
    batchId,
    updatedAt: executedAt,
  }))

  const truncated: TruncatedGroupRow[] = cut.map((item, index) => ({
    truncateKey: `${plan.planCode}|${windowId}|${item.bucket.groupKey}`,
    planId: plan.id,
    planCode: plan.planCode,
    windowId,
    groupKey: item.bucket.groupKey,
    aggAmount: item.aggAmount,
    recordCount: item.recordCount,
    truncateReason: `超出最大输出行数${limit}：按聚合金额降序、金额相同按分组名升序排序后位列第${limit + index + 1}，该分组已截断不进入结果，重试不得追加同名分组`,
    batchId,
    updatedAt: executedAt,
  }))

  const boundaryBasis =
    `窗口=${windowId}；时间边界做法=${policy}；扫描候选订单${scannedCount}条，有效参与${included.length}条，` +
    `其中补报订单${lateCount}条；业务月命中按业务窗口归属，入账月晚于业务月的订单${policy === '双窗口保留' ? '同时保留在已完成窗口与下一窗口' : '仅保留在业务窗口，下一窗口排除补报金额'}；` +
    `筛选条件=${filters.length ? filters.map((f) => `${f.field}=${f.value}`).join(';') : '无'}；非「${VALID_ORDER_STATUS}」订单不参与金额计算`

  const conflictBasis =
    `结果明细唯一键=方案编号|窗口标识|分组取值；同方案同窗口重试按唯一键整体覆盖，不追加第二份同名分组；` +
    (maxRows !== null && maxRows > 0
      ? `最大输出行数${maxRows}与窗口边界同时生效，被截断的${cut.length}个分组只登记截断原因，不进入结果明细，导出不含其金额；`
      : '未设置最大输出行数，不做截断；') +
    `并发重试由服务层互斥锁拦截，只保留一份聚合结果数据明细依据（批次${batchId}）`

  return {
    results,
    truncated,
    scannedCount,
    includedCount: included.length,
    lateCount,
    boundaryBasis,
    conflictBasis,
  }
}

export type StoredRun = Pick<
  AggregateRunRecord,
  | 'batchId'
  | 'planId'
  | 'planCode'
  | 'windowId'
  | 'aggFunction'
  | 'targetField'
  | 'groupField'
  | 'maxRows'
  | 'latePolicy'
  | 'scannedCount'
  | 'includedCount'
  | 'lateCount'
  | 'resultCount'
  | 'truncatedCount'
  | 'boundaryBasis'
  | 'conflictBasis'
  | 'outcome'
  | 'executedAt'
>
