/**
 * 聚合执行相关的领域类型。
 *
 * 与通用的 EntryRow 分开：订单原始记录、聚合结果数据明细、截断分组、执行依据
 * 都由聚合执行链路产生，字段结构独立维护。
 */

/** 订单原始记录（localStorage: data-explore-studio:orders） */
export type OrderRecord = {
  /** 订单编号 */
  orderId: string
  /** 业务发生日期 YYYY-MM-DD */
  bizDate: string
  /** 登记/入账日期 YYYY-MM-DD，晚于 bizDate 即补报（迟到）订单 */
  postDate: string
  /** 区域，分组维度的取值来源之一 */
  region: string
  /** 商品品类，分组维度的取值来源之一 */
  category: string
  /** 渠道 */
  channel: string
  /** 订单金额（元） */
  amount: number
  /** 订单状态，仅「有效」订单参与聚合金额计算 */
  status: string
}

/** 迟到订单冲突判定处理做法，两种做法都可评估，执行时显式选择并留痕 */
export type LateOrderPolicy =
  /** 做法A：迟到订单同时保留在业务月窗口与入账月窗口（双窗口） */
  | '双窗口保留'
  /** 做法B：迟到订单只进入业务月窗口，入账月窗口排除补报金额 */
  | '仅业务窗口'

/** 聚合结果数据明细（localStorage: data-explore-studio:aggregate-results） */
export type AggregateResultRow = {
  /** 明细编号，同时承担聚合结果数据明细依据的唯一键 */
  resultKey: string
  /** 聚合方案行 id（aggregate 模块 EntryRow.id） */
  planId: number
  /** 方案编号，如 AGGR-0003 */
  planCode: string
  /** 聚合函数（承载聚合方案） */
  aggFunction: string
  /** 目标字段（承载目标字段） */
  targetField: string
  /** 分组维度 */
  groupField: string
  /** 时间窗口标识，按月 YYYY-MM */
  windowId: string
  /** 分组取值，如 区域=华东 */
  groupKey: string
  /** 聚合金额，按方案输出精度四舍五入 */
  aggAmount: number
  /** 参与记录数（窗口内命中该分组的有效订单条数） */
  recordCount: number
  /** 其中补报（迟到）订单条数 */
  lateCount: number
  /** 补报金额，导出时单列，避免悄悄混入旧窗口 */
  lateAmount: number
  /** 常规订单金额 */
  normalAmount: number
  /** 输出精度（小数位） */
  precision: number
  /** 参与的订单编号，排序/翻页后仍可定位并复核原记录 */
  orderIds: string[]
  /** 最近一次写入该明细的执行批次号 */
  batchId: string
  /** 最近写入时间 ISO 字符串，刷新后回看仍在 */
  updatedAt: string
}

/** 被行数上限截断、不能进入结果的分组（localStorage: data-explore-studio:aggregate-truncated） */
export type TruncatedGroupRow = {
  /** 截断依据唯一键：方案 + 窗口 + 分组 */
  truncateKey: string
  planId: number
  planCode: string
  windowId: string
  groupKey: string
  /** 该分组本来算出来的聚合金额 */
  aggAmount: number
  /** 参与记录数 */
  recordCount: number
  /** 截断原因，含行数上限与排序规则，冲突判定保留依据 */
  truncateReason: string
  batchId: string
  updatedAt: string
}

/** 聚合执行依据/执行记录（localStorage: data-explore-studio:aggregate-runs） */
export type AggregateRunRecord = {
  runId: number
  batchId: string
  planId: number
  planCode: string
  windowId: string
  aggFunction: string
  targetField: string
  groupField: string
  /** 最大输出行数，空值表示不限制 */
  maxRows: number | null
  latePolicy: LateOrderPolicy
  /** 扫描到的窗口候选订单数 */
  scannedCount: number
  /** 参与聚合的有效订单数 */
  includedCount: number
  /** 迟到订单数 */
  lateCount: number
  /** 写入的结果明细行数 */
  resultCount: number
  /** 截断的分组数 */
  truncatedCount: number
  /** 窗口边界处理依据（迟到订单双窗口/排除规则的判定说明） */
  boundaryBasis: string
  /** 截断与重试冲突判定依据 */
  conflictBasis: string
  /** 结果：成功 / 并发冲突忽略 */
  outcome: string
  executedAt: string
}

/** 执行聚合的入参 */
export type ExecuteAggregateInput = {
  planId: number
  windowId: string
  maxRows: number | null
  latePolicy: LateOrderPolicy
}

/** 执行聚合的返回 */
export type ExecuteAggregateOutput = {
  ok: boolean
  message: string
  batchId?: string
  run?: AggregateRunRecord
}

/** 结果明细的排序字段 */
export type ResultSortField = 'groupKey' | 'aggAmount' | 'recordCount' | 'lateAmount'
export type SortDirection = 'asc' | 'desc'

export type ResultPageQuery = {
  planId?: number
  windowId?: string
  keyword?: string
  sortField: ResultSortField
  sortDirection: SortDirection
  page: number
  size: number
}

export type ResultPage = {
  items: AggregateResultRow[]
  total: number
  page: number
  size: number
}
