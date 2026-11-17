<template>
  <section class="page" data-module="aggregate">
    <header class="page-head">
      <div>
        <h2>聚合计算管理</h2>
        <p class="page-desc">
          维护聚合方案并执行聚合：读取订单原始记录，按分组维度聚合金额，生成带窗口标识与参与记录数的聚合结果数据明细，
          支持重试覆盖、截断留痕、排序翻页、原记录复核与下游文件导出。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记聚合方案</button>
        <button class="btn" type="button" @click="exportRows">导出聚合计算清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">聚合方案总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已启用方案</span>
        <strong class="stat-value">{{ rows.filter((row) => row.status === '已启用').length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">结果明细总数</span>
        <strong class="stat-value">{{ resultTotal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">截断分组数</span>
        <strong class="stat-value">{{ truncatedTotal }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link primary-link" type="button" @click="openExecute(row)">执行聚合</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无聚合计算数据，可先登记聚合方案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条聚合计算记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <AggregateResultPanel
      :plans="allPlans"
      :windows="windows"
      :execution-tick="executionTick"
      @drill="openDrill"
    />

    <AggregateExecuteDialog
      :open="dialogOpen"
      :plan="activePlan"
      :windows="windows"
      @cancel="dialogOpen = false"
      @confirm="handleExecuteConfirm"
    />

    <OrderDrillModal
      :open="drillOpen"
      :result="drillResult"
      :orders="drillOrders"
      @close="drillOpen = false"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  availableWindows,
  executeAggregateAsync,
  findOrdersByIds,
} from '@/api/aggregate-service'
import { listAggregateResults, listTruncatedGroups } from '@/data/aggregate-store'
import type {
  AggregateResultRow,
  LateOrderPolicy,
  OrderRecord,
} from '@/data/aggregate-types'
import type { EntryRow } from '@/data/types'
import AggregateExecuteDialog from './AggregateExecuteDialog.vue'
import AggregateResultPanel from './AggregateResultPanel.vue'
import OrderDrillModal from './OrderDrillModal.vue'

const meta = moduleMeta('aggregate')
const columns = ['方案编号', '聚合函数', '目标字段', '分组维度', '时间窗口', '筛选条件', '输出精度', '缓存时间']
const actions = ['提交校验', '启用方案', '停用方案']
const statuses = ['草稿', '待校验', '已启用', '已停用']

const rows = ref<EntryRow[]>([])
const allPlans = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const windows = availableWindows()

const dialogOpen = ref(false)
const activePlan = ref<EntryRow | null>(null)
const executionTick = ref(0)
const executing = ref(false)

const drillOpen = ref(false)
const drillResult = ref<AggregateResultRow | null>(null)
const drillOrders = ref<OrderRecord[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const resultTotal = computed(() => listAggregateResults().length)
const truncatedTotal = computed(() => listTruncatedGroups().length)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '聚合方案登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openExecute(row: EntryRow) {
  errorMessage.value = ''
  activePlan.value = row
  dialogOpen.value = true
}

async function handleExecuteConfirm(payload: { windowId: string; maxRows: number | null; latePolicy: LateOrderPolicy }) {
  if (!activePlan.value || executing.value) {
    return
  }
  executing.value = true
  try {
    const result = await executeAggregateAsync({
      planId: Number(activePlan.value.id),
      windowId: payload.windowId,
      maxRows: payload.maxRows,
      latePolicy: payload.latePolicy,
    })
    errorMessage.value = result.ok ? '' : result.message
    if (result.ok) {
      dialogOpen.value = false
      executionTick.value += 1
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '聚合执行失败'
  } finally {
    executing.value = false
  }
}

function openDrill(row: AggregateResultRow) {
  drillResult.value = row
  drillOrders.value = findOrdersByIds(row.orderIds)
  drillOpen.value = true
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allPlans.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '聚合计算列表读取失败'
  }
}

onMounted(reload)
</script>
