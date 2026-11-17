<template>
  <div v-if="open" class="modal-mask" @click.self="emitClose">
    <div class="modal-card wide" role="dialog" aria-modal="true" aria-label="参与订单原始记录">
      <header class="modal-head">
        <h3>参与订单原始记录复核</h3>
        <button class="link" type="button" @click="emitClose">关闭</button>
      </header>

      <p v-if="result" class="modal-tip">
        {{ result.planCode }} · 窗口 {{ result.windowId }} · {{ result.groupKey }}：
        聚合金额 {{ result.aggAmount }}（常规 {{ result.normalAmount }} / 补报 {{ result.lateAmount }}），
        参与记录数 {{ result.recordCount }}，输出精度 {{ result.precision }} 位小数
      </p>

      <table class="data-table">
        <thead>
          <tr>
            <th>订单编号</th>
            <th>业务日期</th>
            <th>入账日期</th>
            <th>区域</th>
            <th>商品品类</th>
            <th>渠道</th>
            <th>金额</th>
            <th>状态</th>
            <th>窗口内标记</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in orders" :key="order.orderId">
            <td>{{ order.orderId }}</td>
            <td>{{ order.bizDate }}</td>
            <td>{{ order.postDate }}</td>
            <td>{{ order.region }}</td>
            <td>{{ order.category }}</td>
            <td>{{ order.channel }}</td>
            <td>{{ order.amount }}</td>
            <td>{{ order.status }}</td>
            <td>
              <span :class="isLate(order) ? 'tag tag-warn' : 'tag tag-ok'">
                {{ isLate(order) ? '补报订单' : '常规订单' }}
              </span>
            </td>
          </tr>
          <tr v-if="!orders.length">
            <td colspan="9" class="empty-state">没有可复核的原始订单</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AggregateResultRow, OrderRecord } from '@/data/aggregate-types'

defineProps<{
  open: boolean
  result: AggregateResultRow | null
  orders: OrderRecord[]
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

/** 补报判定与引擎一致：入账月晚于业务月即为迟到订单，窗口内由聚合结果的 lateCount 佐证 */
function isLate(order: OrderRecord): boolean {
  return order.postDate.slice(0, 7) > order.bizDate.slice(0, 7)
}

function emitClose() {
  emit('close')
}
</script>
