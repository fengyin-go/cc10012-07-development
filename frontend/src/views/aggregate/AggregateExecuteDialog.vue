<template>
  <div v-if="open" class="modal-mask" @click.self="emitCancel">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="执行聚合方案">
      <header class="modal-head">
        <h3>执行聚合方案</h3>
        <button class="link" type="button" @click="emitCancel">关闭</button>
      </header>

      <dl class="plan-summary">
        <div><dt>方案编号</dt><dd>{{ plan?.['方案编号'] }}</dd></div>
        <div><dt>聚合函数</dt><dd>{{ plan?.['聚合函数'] }}</dd></div>
        <div><dt>目标字段</dt><dd>{{ plan?.['目标字段'] }}</dd></div>
        <div><dt>分组维度</dt><dd>{{ plan?.['分组维度'] }}</dd></div>
        <div><dt>方案窗口</dt><dd>{{ plan?.['时间窗口'] }}</dd></div>
        <div><dt>输出精度</dt><dd>{{ plan?.['输出精度'] }}</dd></div>
      </dl>

      <form class="modal-form" @submit.prevent="confirm">
        <label class="filter-item">
          <span>时间窗口标识（按月）</span>
          <select v-model="windowId">
            <option v-for="item in windows" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>

        <label class="filter-item">
          <span>最大输出行数（留空表示不限制）</span>
          <input v-model="maxRowsText" inputmode="numeric" placeholder="例如 5，超行分组带截断原因不进结果" />
        </label>

        <label class="filter-item">
          <span>迟到订单冲突判定做法（两种做法都可评估）</span>
          <select v-model="latePolicy">
            <option value="双窗口保留">双窗口保留：补报订单同时计入已完成窗口与下一窗口</option>
            <option value="仅业务窗口">仅业务窗口：下一窗口排除补报金额</option>
          </select>
        </label>

        <p class="modal-tip">
          同方案同窗口重试会整体覆盖旧明细，不会追加第二份同名分组；并发重试由互斥标记拦截。
        </p>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="emitCancel">取消</button>
          <button class="btn primary" type="submit">确认执行</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import type { EntryRow } from '@/data/types'
import type { LateOrderPolicy } from '@/data/aggregate-types'

const props = defineProps<{
  open: boolean
  plan: EntryRow | null
  windows: string[]
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'confirm', payload: { windowId: string; maxRows: number | null; latePolicy: LateOrderPolicy }): void
}>()

const windowId = ref('')
const maxRowsText = ref('')
const latePolicy = ref<LateOrderPolicy>('双窗口保留')
const errorMessage = ref('')

watch(
  () => props.open,
  (open) => {
    if (open && props.plan) {
      windowId.value = String(props.plan['时间窗口'] ?? props.windows[0] ?? '')
      maxRowsText.value = ''
      latePolicy.value = '双窗口保留'
      errorMessage.value = ''
    }
  },
)

function emitCancel() {
  emit('cancel')
}

function confirm() {
  errorMessage.value = ''
  const trimmed = maxRowsText.value.trim()
  let maxRows: number | null = null
  if (trimmed) {
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errorMessage.value = '最大输出行数必须是正整数，或留空表示不限制'
      return
    }
    maxRows = parsed
  }
  if (!windowId.value) {
    errorMessage.value = '请选择时间窗口'
    return
  }
  emit('confirm', { windowId: windowId.value, maxRows, latePolicy: latePolicy.value })
}
</script>
