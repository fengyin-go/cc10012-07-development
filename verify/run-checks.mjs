/**
 * 聚合执行链路的 Node 验证脚本（位于纯前端工程之外，不参与构建）。
 *
 * 覆盖需求点：
 * 1. 读取订单原始记录，按分组维度聚合金额，生成聚合结果数据明细（AGGR-0003 汇总 9 月）；
 * 2. 时间窗口边界 + 最大输出行数同时生效：截断组不进结果、带截断原因；
 * 3. 重试整体覆盖，不追加第二份同名分组；并发重试只保留一份明细依据；
 * 4. 迟到订单双窗口/仅业务窗口两种做法，窗口标识、参与记录数、补报金额可核对；
 * 5. 排序、分页、翻页后仍能用 orderIds 定位原记录，金额/记录数/精度可复核；
 * 6. 导出 CSV：结果明细（补报单列）、截断分组、执行依据分别写出下游文件；
 * 7. 刷新持久化：模拟 localStorage 重新加载模块后结果仍在。
 */

import './local-storage-shim.mjs'

const service = await import('./dist/aggregate-service.mjs')

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    failures.push(`${name} ${detail}`)
    console.error(`  ✗ ${name} ${detail}`)
  }
}

function approx(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon
}

const PLAN_AGGR_0003 = 3
const PLAN_AGGR_0001 = 1
const PLAN_AGGR_0002 = 2
const W_2026_09 = '2026-09'
const W_2026_08 = '2026-08'

// 手工从 order-seed.ts 逐单核对出的期望值（双窗口保留，2026-09，AGGR-0003 按区域 SUM）
const EXPECTED_09_DUAL = {
  '区域=华东': { amount: 8090, count: 7, late: 700, lateCount: 1 },
  '区域=华南': { amount: 7860, count: 7, late: 710, lateCount: 2 },
  '区域=华北': { amount: 5670, count: 6, late: 980, lateCount: 1 },
  '区域=西南': { amount: 7580, count: 5, late: 0, lateCount: 0 },
  '区域=华中': { amount: 6030, count: 5, late: 0, lateCount: 0 },
  '区域=西北': { amount: 1170, count: 3, late: 0, lateCount: 0 },
  '区域=东北': { amount: 1050, count: 3, late: 0, lateCount: 0 },
}
const EXPECTED_09_TOTAL_RECORDS = Object.values(EXPECTED_09_DUAL).reduce((s, g) => s + g.count, 0)
const EXPECTED_09_TOTAL_AMOUNT = Object.values(EXPECTED_09_DUAL).reduce((s, g) => s + g.amount, 0)

console.log('\n[1] AGGR-0003 汇总 2026-09 订单：分组唯一、金额与记录数可核对')
const first = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: null,
  latePolicy: '双窗口保留',
})
check('首次执行成功', first.ok === true, first.message)
const rows09 = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('每个分组只出现一次（7 个区域各一条）', rows09.items.length === 7, `实际 ${rows09.items.length}`)
check('结果总数与分页 total 一致', rows09.total === 7)
const keys = rows09.items.map((r) => r.resultKey)
check('resultKey 全局唯一', new Set(keys).size === keys.length)
for (const row of rows09.items) {
  const expected = EXPECTED_09_DUAL[row.groupKey]
  check(`${row.groupKey} 聚合金额=${expected.amount}`, approx(row.aggAmount, expected.amount), `实际 ${row.aggAmount}`)
  check(`${row.groupKey} 参与记录数=${expected.count}`, row.recordCount === expected.count, `实际 ${row.recordCount}`)
  check(`${row.groupKey} 补报金额=${expected.late}`, approx(row.lateAmount, expected.late), `实际 ${row.lateAmount}`)
  check(`${row.groupKey} 补报条数=${expected.lateCount}`, row.lateCount === expected.lateCount, `实际 ${row.lateCount}`)
  check(`${row.groupKey} 明细承载方案与目标字段`, row.planCode === 'AGGR-0003' && row.targetField === '金额' && row.aggFunction === 'SUM')
  check(`${row.groupKey} 保留窗口标识`, row.windowId === W_2026_09)
  check(`${row.groupKey} 输出精度为 2 位`, row.precision === 2)
  check(`${row.groupKey} 金额=常规+补报`, approx(row.aggAmount, row.normalAmount + row.lateAmount))
  check(`${row.groupKey} orderIds 数与记录数一致`, row.orderIds.length === row.recordCount)
}
const sumAll = rows09.items.reduce((s, r) => s + r.aggAmount, 0)
const countAll = rows09.items.reduce((s, r) => s + r.recordCount, 0)
check('分组金额合计与手工期望一致', approx(sumAll, EXPECTED_09_TOTAL_AMOUNT), `${sumAll} vs ${EXPECTED_09_TOTAL_AMOUNT}`)
check('参与记录合计 36（34 条 9 月业务订单 + 2 条跨窗口补报，已取消订单被排除）', countAll === EXPECTED_09_TOTAL_RECORDS, `实际 ${countAll}`)
check('参与记录数合计与补报条数可核对', rows09.items.reduce((s, r) => s + r.lateCount, 0) === 4)

console.log('\n[2] 窗口边界 + 最大输出行数同时生效：截断组不进结果且带原因')
const limited = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: 5,
  latePolicy: '双窗口保留',
})
check('限长执行成功', limited.ok === true)
const limitedPage = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'aggAmount',
  sortDirection: 'desc',
  page: 1,
  size: 100,
})
check('结果只保留 5 个分组', limitedPage.items.length === 5, `实际 ${limitedPage.items.length}`)
const truncated = service.listTruncatedGroupRows(PLAN_AGGR_0003, W_2026_09)
check('截断清单含 2 个分组', truncated.length === 2, `实际 ${truncated.length}`)
const keptNames = new Set(limitedPage.items.map((r) => r.groupKey))
check('截断组与结果组不重叠', truncated.every((t) => !keptNames.has(t.groupKey)))
check('金额排名第 6、7 的组被截断（西北 1170 / 东北 1050）',
  truncated.some((t) => t.groupKey === '区域=西北' && approx(t.aggAmount, 1170)) &&
  truncated.some((t) => t.groupKey === '区域=东北' && approx(t.aggAmount, 1050)))
check('保留的 5 个组为金额前 5 名（华东/华南/西南/华中/华北）',
  ['区域=华东', '区域=华南', '区域=西南', '区域=华中', '区域=华北'].every((name) => keptNames.has(name)))
check('截断组带截断原因且含行数上限', truncated.every((t) => t.truncateReason.includes('超出最大输出行数5')))
const resultCsv = service.exportAggregateResultCsv(PLAN_AGGR_0003, W_2026_09)
check('结果导出不含截断组金额', truncated.every((t) => !resultCsv.content.includes(t.groupKey)))
check('结果导出含补报金额列', resultCsv.content.includes('补报金额') && resultCsv.content.includes('补报记录数'))
const truncatedCsv = service.exportTruncatedCsv(PLAN_AGGR_0003, W_2026_09)
check('截断导出含截断原因', truncatedCsv.content.includes('截断原因'))
check('导出文件名指向聚合结果数据明细下游文件', resultCsv.filename.startsWith('聚合结果数据明细'))

console.log('\n[3] 重试整体覆盖：不追加第二份同名分组')
const retry = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: 5,
  latePolicy: '双窗口保留',
})
check('重试成功', retry.ok === true)
const afterRetry = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('重试后仍只有 5 条明细（无重复同名分组）', afterRetry.items.length === 5, `实际 ${afterRetry.items.length}`)
check('重试后 resultKey 仍唯一', new Set(afterRetry.items.map((r) => r.resultKey)).size === 5)
check('明细批次号已更新为重试批次', afterRetry.items.every((r) => r.batchId === retry.batchId))
const retryTruncated = service.listTruncatedGroupRows(PLAN_AGGR_0003, W_2026_09)
check('截断清单同步覆盖仍为 2 条', retryTruncated.length === 2)

// 放宽行数上限后重试：原截断组回归，旧的 5 条被整体替换为 7 条
const widened = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: 10,
  latePolicy: '双窗口保留',
})
const widenedPage = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('放宽上限重试后回到 7 个分组', widenedPage.items.length === 7)
check('该窗口截断清单被清空', service.listTruncatedGroupRows(PLAN_AGGR_0003, W_2026_09).length === 0)

console.log('\n[4] 并发重试：互斥标记拦截，只保留一份明细依据')
service.__setInFlightForTest(PLAN_AGGR_0003, W_2026_09, true)
const concurrent = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: 10,
  latePolicy: '双窗口保留',
})
service.__setInFlightForTest(PLAN_AGGR_0003, W_2026_09, false)
check('并发请求返回冲突提示', concurrent.ok === false && concurrent.message.includes('并发'))
const runs = service.listRunRecords(PLAN_AGGR_0003)
const conflictRun = runs.find((r) => r.outcome === '并发冲突忽略')
check('并发冲突写入执行依据', Boolean(conflictRun))
check('冲突依据说明不追加同名分组', Boolean(conflictRun && conflictRun.conflictBasis.includes('不追加同名分组')))
const afterConflict = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('冲突后明细仍是既有 7 条，未产生第二份', afterConflict.items.length === 7)
check('冲突后明细批次未被改写', afterConflict.items.every((r) => r.batchId === widened.batchId))

console.log('\n[5] 迟到订单两种做法：双窗口保留 vs 仅业务窗口')
const augDual = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_08,
  maxRows: null,
  latePolicy: '双窗口保留',
})
check('08 窗口双窗口做法执行成功', augDual.ok === true)
const augDualPage = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_08,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
const EXPECTED_08 = {
  '区域=华东': { amount: 2850, count: 3, late: 700 },
  '区域=华南': { amount: 1720, count: 3, late: 300 },
  '区域=华北': { amount: 830, count: 2, late: 0 },
  '区域=西南': { amount: 2600, count: 2, late: 0 },
  '区域=华中': { amount: 2400, count: 2, late: 0 },
}
check('08 窗口分组数=5（已取消订单不参与）', augDualPage.items.length === 5, `实际 ${augDualPage.items.length}`)
for (const row of augDualPage.items) {
  const expected = EXPECTED_08[row.groupKey]
  check(`08 ${row.groupKey} 金额=${expected.amount}`, approx(row.aggAmount, expected.amount), `实际 ${row.aggAmount}`)
  check(`08 ${row.groupKey} 记录数=${expected.count}`, row.recordCount === expected.count)
  check(`08 ${row.groupKey} 补报金额=${expected.late}`, approx(row.lateAmount, expected.late))
}
check('08 窗口补报金额单列不混入常规金额',
  augDualPage.items.every((r) => approx(r.normalAmount + r.lateAmount, r.aggAmount)))

// 仅业务窗口重跑 09：入账月副本（700/710/980）应被排除
const bizOnly = service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: null,
  latePolicy: '仅业务窗口',
})
check('仅业务窗口执行成功', bizOnly.ok === true)
const bizOnlyPage = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
const EXPECTED_09_BIZONLY = {
  '区域=华东': { amount: 7390, count: 6, late: 0 },
  '区域=华南': { amount: 7560, count: 6, late: 410 },
  '区域=华北': { amount: 5670, count: 6, late: 980 },
  '区域=西南': { amount: 7580, count: 5, late: 0 },
  '区域=华中': { amount: 6030, count: 5, late: 0 },
  '区域=西北': { amount: 1170, count: 3, late: 0 },
  '区域=东北': { amount: 1050, count: 3, late: 0 },
}
for (const row of bizOnlyPage.items) {
  const expected = EXPECTED_09_BIZONLY[row.groupKey]
  check(`仅业务窗口 ${row.groupKey} 金额=${expected.amount}`, approx(row.aggAmount, expected.amount), `实际 ${row.aggAmount}`)
  check(`仅业务窗口 ${row.groupKey} 补报金额=${expected.late}（跨窗口副本已排除，同月迟到订单仍标记补报）`,
    approx(row.lateAmount, expected.late), `实际 ${row.lateAmount}`)
  check(`仅业务窗口 ${row.groupKey} 记录数=${expected.count}`, row.recordCount === expected.count, `实际 ${row.recordCount}`)
}
const bizRun = service.listRunRecords(PLAN_AGGR_0003).find((r) => r.runId === bizOnly.run.runId)
check('执行依据保留窗口边界做法', bizRun.latePolicy === '仅业务窗口' && bizRun.boundaryBasis.includes('仅保留在业务窗口'))

// 恢复双窗口保留，便于后续导出核对
service.executeAggregate({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  maxRows: null,
  latePolicy: '双窗口保留',
})

console.log('\n[6] 排序、分页、翻页后仍能定位原记录并复核')
const p1 = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'aggAmount',
  sortDirection: 'desc',
  page: 1,
  size: 3,
})
const p2 = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'aggAmount',
  sortDirection: 'desc',
  page: 2,
  size: 3,
})
const p3 = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'aggAmount',
  sortDirection: 'desc',
  page: 3,
  size: 3,
})
check('首页 3 条、次页 3 条、末页 1 条', p1.items.length === 3 && p2.items.length === 3 && p3.items.length === 1)
check('翻页 total 恒为 7', p1.total === 7 && p2.total === 7 && p3.total === 7)
const pagedKeys = [...p1.items, ...p2.items, ...p3.items].map((r) => r.resultKey)
check('翻页无重复无遗漏', new Set(pagedKeys).size === 7 && pagedKeys.length === 7)
check('金额降序排序正确（首位华东 8090）', p1.items[0].groupKey === '区域=华东' && approx(p1.items[0].aggAmount, 8090))
const asc = service.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'aggAmount',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('金额升序排序正确（首位东北 1050）', asc.items[0].groupKey === '区域=东北')
const target = p2.items[0]
const sourceOrders = service.findOrdersByIds(target.orderIds)
check('按 orderIds 可定位全部原始记录', sourceOrders.length === target.recordCount)
check('原记录金额合计等于明细聚合金额', approx(
  sourceOrders.reduce((s, o) => s + o.amount, 0),
  target.aggAmount,
))
check('原记录补报标记与明细补报条数一致',
  sourceOrders.filter((o) => o.postDate.slice(0, 7) > o.bizDate.slice(0, 7)).length === target.lateCount)

console.log('\n[7] 其他聚合函数与精度核对')
const avgRun = service.executeAggregate({
  planId: PLAN_AGGR_0001,
  windowId: W_2026_08,
  maxRows: null,
  latePolicy: '双窗口保留',
})
check('AGGR-0001 AVG 执行成功', avgRun.ok === true)
const avgPage = service.queryAggregateResults({
  planId: PLAN_AGGR_0001,
  windowId: W_2026_08,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
// 08 电子产品有效订单：1200、1500、2100、700 → AVG = 1375.00
const electronics = avgPage.items.find((r) => r.groupKey === '商品品类=电子产品')
check('AVG 金额正确（电子产品均值 1375）', Boolean(electronics) && approx(electronics.aggAmount, 1375))
check('AVG 输出精度 2 位', Boolean(electronics) && electronics.precision === 2)
const countRun = service.executeAggregate({
  planId: PLAN_AGGR_0002,
  windowId: W_2026_09,
  maxRows: null,
  latePolicy: '双窗口保留',
})
const countPage = service.queryAggregateResults({
  planId: PLAN_AGGR_0002,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('COUNT 方案执行成功', countRun.ok === true)
check('COUNT 精度为 0 位且值为整数', countPage.items.every((r) => r.precision === 0 && Number.isInteger(r.aggAmount)))
const countSum = countPage.items.reduce((s, r) => s + r.aggAmount, 0)
check('COUNT 分组之和等于参与记录总数 36', countSum === 36, `实际 ${countSum}`)

console.log('\n[8] 导出下游文件：三类 CSV 内容核对')
const allResultCsv = service.exportAggregateResultCsv()
check('全量结果导出含窗口标识与参与记录数列', allResultCsv.content.includes('窗口标识') && allResultCsv.content.includes('参与记录数'))
check('全量结果导出含 08 与 09 两个窗口', allResultCsv.content.includes(W_2026_08) && allResultCsv.content.includes(W_2026_09))
check('CSV 带 UTF-8 BOM', allResultCsv.content.charCodeAt(0) === 0xfeff)
const runCsv = service.exportRunRecordCsv(PLAN_AGGR_0003)
check('执行依据导出含边界依据与冲突判定两列', runCsv.content.includes('窗口边界依据') && runCsv.content.includes('冲突判定依据'))
check('执行依据包含并发冲突记录', runCsv.content.includes('并发冲突忽略'))
check('执行依据包含两种迟到做法', runCsv.content.includes('双窗口保留') && runCsv.content.includes('仅业务窗口'))

console.log('\n[9] 刷新后仍可回看聚合结果数据明细（模拟重新加载模块）')
const fresh = await import(`./dist/aggregate-service.mjs?fresh=${Date.now()}`)
const reloaded = fresh.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('新模块实例从 localStorage 读到历史明细（08 五组 + 09 七组 = 12）', reloaded.total === 12, `实际 ${reloaded.total}`)
const reloaded09 = fresh.queryAggregateResults({
  planId: PLAN_AGGR_0003,
  windowId: W_2026_09,
  sortField: 'groupKey',
  sortDirection: 'asc',
  page: 1,
  size: 100,
})
check('刷新后 09 窗口 7 个分组仍在', reloaded09.items.length === 7)
check('刷新后金额与首次计算一致', approx(
  reloaded09.items.reduce((s, r) => s + r.aggAmount, 0),
  EXPECTED_09_TOTAL_AMOUNT,
))
check('刷新后执行依据仍可回看', fresh.listRunRecords(PLAN_AGGR_0003).length === service.listRunRecords(PLAN_AGGR_0003).length)
check('刷新后截断依据随窗口数据持久化（08 无截断、09 已无截断）',
  fresh.listTruncatedGroupRows(PLAN_AGGR_0003).length === 0)
check('刷新后订单原始记录自动播种', fresh.findOrdersByIds(['ORD-20260901']).length === 1)

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) {
  console.error('失败项：\n - ' + failures.join('\n - '))
  process.exit(1)
}
console.log('全部断言通过。')
