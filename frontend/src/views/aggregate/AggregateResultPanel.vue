<template>
  <section class="result-panel">
    <header class="panel-head">
      <h3>聚合结果数据明细</h3>
      <div class="row-actions">
        <button class="btn" type="button" @click="exportResults">导出结果明细（下游 CSV）</button>
        <button class="btn" type="button" @click="exportTruncated">导出截断分组</button>
        <button class="btn" type="button" @click="exportRuns">导出执行依据</button>
      </div>
    </header>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>方案编号</span>
        <select v-model="planFilter" @change="onFilterChange">
          <option value="">全部方案</option>
          <option v-for="plan in plans" :key="String(plan.id)" :value="Number(plan.id)">
            {{ plan['方案编号'] }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>窗口标识</span>
        <select v-model="windowFilter" @change="onFilterChange">
          <option value="">全部窗口</option>
          <option v-for="item in windows" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>分组/订单编号检索</span>
        <input v-model="keyword" placeholder="分组取值或订单编号" @change="onFilterChange" />
      </label>
      <button class="btn" type="submit">查询</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.prop">
            <button v-if="column.sortable" class="link sort-link" type="button" @click="toggleSort(column.prop)">
              {{ column.label }}<span class="sort-mark">{{ sortMark(column.prop) }}</span>
            </button>
            <span v-else>{{ column.label }}</span>
          </th>
          <th>复核操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in page.items" :key="row.resultKey">
          <td>{{ row.planCode }}</td>
          <td>{{ row.windowId }}</td>
          <td>{{ row.groupKey }}</td>
          <td>{{ row.aggFunction }}</td>
          <td>{{ row.targetField }}</td>
          <td class="num">{{ row.aggAmount }}</td>
          <td class="num">{{ row.recordCount }}</td>
          <td class="num">{{ row.normalAmount }}</td>
          <td class="num">
            {{ row.lateAmount }}
            <span v-if="row.lateCount > 0" class="tag tag-warn">补报{{ row.lateCount }}条</span>
          </td>
          <td>{{ row.precision }} 位</td>
          <td class="cell-ids" :title="row.orderIds.join(';')">{{ row.orderIds.join(';') }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="emit('drill', row)">定位原记录</button>
          </td>
        </tr>
        <tr v-if="!page.items.length">
          <td :colspan="columns.length + 1" class="empty-state">
            暂无聚合结果数据明细，请在上方方案列表选择「执行聚合」
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="pager">
      <span>共 {{ page.total }} 条明细，第 {{ page.page }} / {{ totalPages }} 页</span>
      <div class="row-actions">
        <button class="btn" type="button" :disabled="page.page <= 1" @click="goPage(1)">首页</button>
        <button class="btn" type="button" :disabled="page.page <= 1" @click="goPage(page.page - 1)">上一页</button>
        <button class="btn" type="button" :disabled="page.page >= totalPages" @click="goPage(page.page + 1)">下一页</button>
        <label class="page-size">
          每页
          <select v-model.number="size" @change="onSizeChange">
            <option :value="5">5</option>
            <option :value="8">8</option>
            <option :value="15">15</option>
          </select>
          条
        </label>
      </div>
    </footer>

    <section class="sub-panel">
      <h4>截断分组（行数上限生效，不进入结果、不计入导出金额）</h4>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>方案编号</th><th>窗口标识</th><th>分组取值</th><th>聚合金额</th><th>参与记录数</th><th>截断原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in truncatedRows" :key="row.truncateKey">
            <td>{{ row.planCode }}</td>
            <td>{{ row.windowId }}</td>
            <td>{{ row.groupKey }}</td>
            <td class="num">{{ row.aggAmount }}</td>
            <td class="num">{{ row.recordCount }}</td>
            <td>{{ row.truncateReason }}</td>
          </tr>
          <tr v-if="!truncatedRows.length">
            <td colspan="6" class="empty-state">暂无截断分组</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="sub-panel">
      <h4>执行依据（窗口边界与冲突判定留痕，刷新后仍可回看）</h4>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>#</th><th>方案/窗口</th><th>做法</th><th>行数上限</th>
            <th>扫描/参与/补报</th><th>结果/截断</th><th>结果</th><th>判定依据</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runRows" :key="run.runId">
            <td>{{ run.runId }}</td>
            <td>{{ run.planCode }} · {{ run.windowId }}</td>
            <td>{{ run.latePolicy }}</td>
            <td>{{ run.maxRows === null ? '不限' : run.maxRows }}</td>
            <td>{{ run.scannedCount }} / {{ run.includedCount }} / {{ run.lateCount }}</td>
            <td>{{ run.resultCount }} / {{ run.truncatedCount }}</td>
            <td>
              <span :class="run.outcome === '执行成功' ? 'tag tag-ok' : 'tag tag-warn'">{{ run.outcome }}</span>
            </td>
            <td class="cell-basis" :title="`${run.boundaryBasis}\n${run.conflictBasis}`">
              {{ run.boundaryBasis }}<br />{{ run.conflictBasis }}
            </td>
          </tr>
          <tr v-if="!runRows.length">
            <td colspan="8" class="empty-state">暂无执行记录</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadCsv,
  exportAggregateResultCsv,
  exportRunRecordCsv,
  exportTruncatedCsv,
  listRunRecords,
  listTruncatedGroupRows,
  queryAggregateResults,
} from '@/api/aggregate-service'
import { loadViewState, saveViewState } from '@/data/aggregate-store'
import type {
  AggregateResultRow,
  AggregateRunRecord,
  ResultPage as ResultPageData,
  ResultSortField,
  SortDirection,
  TruncatedGroupRow,
} from '@/data/aggregate-types'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  plans: EntryRow[]
  windows: string[]
  /** 执行完成后父组件递增该值，触发明细重新读取 */
  executionTick: number
}>()

const emit = defineEmits<{
  (event: 'drill', row: AggregateResultRow): void
}>()

const columns: { prop: string; label: string; sortable?: boolean }[] = [
  { prop: 'planCode', label: '方案编号' },
  { prop: 'windowId', label: '窗口标识' },
  { prop: 'groupKey', label: '分组取值', sortable: true },
  { prop: 'aggFunction', label: '聚合函数' },
  { prop: 'targetField', label: '目标字段' },
  { prop: 'aggAmount', label: '聚合金额', sortable: true },
  { prop: 'recordCount', label: '参与记录数', sortable: true },
  { prop: 'normalAmount', label: '常规金额' },
  { prop: 'lateAmount', label: '补报金额', sortable: true },
  { prop: 'precision', label: '输出精度' },
  { prop: 'orderIds', label: '参与订单编号' },
]

const SORTABLE_FIELDS = new Set<ResultSortField>(['groupKey', 'aggAmount', 'recordCount', 'lateAmount'])

const saved = loadViewState()
const planFilter = ref<string>('')
const windowFilter = ref(saved.windowFilter)
const keyword = ref(saved.keyword)
const sortField = ref<ResultSortField>(saved.sortField as ResultSortField)
const sortDirection = ref<SortDirection>(saved.sortDirection)
const page = ref<ResultPageData>({ items: [], total: 0, page: 1, size: saved.size })
const size = ref(saved.size)
const currentPage = ref(saved.page)
const truncatedRows = ref<TruncatedGroupRow[]>([])
const runRows = ref<AggregateRunRecord[]>([])

const totalPages = computed(() => Math.max(1, Math.ceil(page.value.total / size.value)))

function persistView() {
  saveViewState({
    keyword: keyword.value,
    windowFilter: windowFilter.value,
    sortField: sortField.value,
    sortDirection: sortDirection.value,
    page: currentPage.value,
    size: size.value,
  })
}

function reload() {
  const result = queryAggregateResults({
    planId: planFilter.value === '' ? undefined : Number(planFilter.value),
    windowId: windowFilter.value || undefined,
    keyword: keyword.value,
    sortField: sortField.value,
    sortDirection: sortDirection.value,
    page: currentPage.value,
    size: size.value,
  })
  page.value = result
  currentPage.value = result.page
  truncatedRows.value = listTruncatedGroupRows(
    planFilter.value === '' ? undefined : Number(planFilter.value),
    windowFilter.value || undefined,
  )
  runRows.value = listRunRecords(planFilter.value === '' ? undefined : Number(planFilter.value))
  persistView()
}

function onFilterChange() {
  currentPage.value = 1
  reload()
}

function onSizeChange() {
  currentPage.value = 1
  reload()
}

function goPage(target: number) {
  currentPage.value = target
  reload()
}

function toggleSort(field: string) {
  if (!SORTABLE_FIELDS.has(field as ResultSortField)) {
    return
  }
  const sortableField = field as ResultSortField
  if (sortField.value === sortableField) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = sortableField
    sortDirection.value = 'desc'
  }
  reload()
}

function sortMark(field: string): string {
  if (sortField.value !== field) {
    return ''
  }
  return sortDirection.value === 'asc' ? ' ↑' : ' ↓'
}

function exportResults() {
  const { filename, content } = exportAggregateResultCsv(
    planFilter.value === '' ? undefined : Number(planFilter.value),
    windowFilter.value || undefined,
  )
  downloadCsv(filename, content)
}

function exportTruncated() {
  const { filename, content } = exportTruncatedCsv(
    planFilter.value === '' ? undefined : Number(planFilter.value),
    windowFilter.value || undefined,
  )
  downloadCsv(filename, content)
}

function exportRuns() {
  const { filename, content } = exportRunRecordCsv(
    planFilter.value === '' ? undefined : Number(planFilter.value),
  )
  downloadCsv(filename, content)
}

watch(() => props.executionTick, reload)
onMounted(reload)
</script>
