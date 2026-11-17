import type { OrderRecord } from './aggregate-types'

/**
 * 订单原始记录示例数据：聚合执行读取的唯一数据源。
 *
 * 覆盖 2026-08 / 2026-09 两个业务窗口，并刻意安排了补报（迟到）订单：
 * - 业务月在 08、入账月在 09 的订单，会同时落在已完成窗口（08）和下一窗口（09）；
 * - 业务月与入账月同为 09 的迟到订单，仍落在 09 窗口但带补报标记；
 * - 含 1 条已取消订单，验证非有效订单不参与金额聚合。
 */
export const SEED_ORDERS: OrderRecord[] = [
  // ---------- 2026-08 业务窗口 ----------
  { orderId: 'ORD-20260801', bizDate: '2026-08-02', postDate: '2026-08-02', region: '华东', category: '电子产品', channel: '线上', amount: 1200, status: '有效' },
  { orderId: 'ORD-20260802', bizDate: '2026-08-05', postDate: '2026-08-06', region: '华南', category: '家居用品', channel: '线下', amount: 800, status: '有效' },
  { orderId: 'ORD-20260803', bizDate: '2026-08-08', postDate: '2026-08-09', region: '华北', category: '办公用品', channel: '线上', amount: 450, status: '有效' },
  { orderId: 'ORD-20260804', bizDate: '2026-08-12', postDate: '2026-08-13', region: '西南', category: '电子产品', channel: '线下', amount: 1500, status: '有效' },
  { orderId: 'ORD-20260805', bizDate: '2026-08-15', postDate: '2026-08-16', region: '华中', category: '食品饮料', channel: '线上', amount: 300, status: '有效' },
  { orderId: 'ORD-20260806', bizDate: '2026-08-18', postDate: '2026-08-19', region: '华东', category: '家居用品', channel: '线下', amount: 950, status: '有效' },
  { orderId: 'ORD-20260807', bizDate: '2026-08-21', postDate: '2026-08-22', region: '华南', category: '办公用品', channel: '线上', amount: 620, status: '有效' },
  { orderId: 'ORD-20260808', bizDate: '2026-08-24', postDate: '2026-08-25', region: '华北', category: '食品饮料', channel: '线下', amount: 380, status: '有效' },
  { orderId: 'ORD-20260809', bizDate: '2026-08-27', postDate: '2026-08-28', region: '西南', category: '家居用品', channel: '线上', amount: 1100, status: '有效' },
  { orderId: 'ORD-20260810', bizDate: '2026-08-30', postDate: '2026-08-31', region: '华中', category: '电子产品', channel: '线下', amount: 2100, status: '有效' },
  // 08 业务、09 才入账：跨窗口补报，双窗口都可能成立
  { orderId: 'ORD-20260811', bizDate: '2026-08-29', postDate: '2026-09-02', region: '华东', category: '电子产品', channel: '线上', amount: 700, status: '有效' },
  { orderId: 'ORD-20260812', bizDate: '2026-08-31', postDate: '2026-09-04', region: '华南', category: '食品饮料', channel: '线下', amount: 300, status: '有效' },
  { orderId: 'ORD-20260813', bizDate: '2026-08-20', postDate: '2026-09-01', region: '华中', category: '办公用品', channel: '线上', amount: 0, status: '已取消' },

  // ---------- 2026-09 业务窗口 ----------
  { orderId: 'ORD-20260901', bizDate: '2026-09-01', postDate: '2026-09-01', region: '华东', category: '电子产品', channel: '线上', amount: 2000, status: '有效' },
  { orderId: 'ORD-20260902', bizDate: '2026-09-02', postDate: '2026-09-03', region: '华南', category: '家居用品', channel: '线下', amount: 1500, status: '有效' },
  { orderId: 'ORD-20260903', bizDate: '2026-09-03', postDate: '2026-09-04', region: '华北', category: '办公用品', channel: '线上', amount: 800, status: '有效' },
  { orderId: 'ORD-20260904', bizDate: '2026-09-04', postDate: '2026-09-05', region: '西南', category: '电子产品', channel: '线下', amount: 2600, status: '有效' },
  { orderId: 'ORD-20260905', bizDate: '2026-09-05', postDate: '2026-09-06', region: '华中', category: '食品饮料', channel: '线上', amount: 500, status: '有效' },
  { orderId: 'ORD-20260906', bizDate: '2026-09-07', postDate: '2026-09-08', region: '华东', category: '家居用品', channel: '线下', amount: 1300, status: '有效' },
  { orderId: 'ORD-20260907', bizDate: '2026-09-08', postDate: '2026-09-09', region: '华南', category: '办公用品', channel: '线上', amount: 900, status: '有效' },
  { orderId: 'ORD-20260908', bizDate: '2026-09-09', postDate: '2026-09-10', region: '华北', category: '食品饮料', channel: '线下', amount: 650, status: '有效' },
  { orderId: 'ORD-20260909', bizDate: '2026-09-10', postDate: '2026-09-11', region: '西南', category: '家居用品', channel: '线上', amount: 1800, status: '有效' },
  { orderId: 'ORD-20260910', bizDate: '2026-09-11', postDate: '2026-09-12', region: '华中', category: '电子产品', channel: '线下', amount: 3200, status: '有效' },
  { orderId: 'ORD-20260911', bizDate: '2026-09-12', postDate: '2026-09-13', region: '西北', category: '食品饮料', channel: '线上', amount: 260, status: '有效' },
  { orderId: 'ORD-20260912', bizDate: '2026-09-13', postDate: '2026-09-14', region: '东北', category: '办公用品', channel: '线下', amount: 340, status: '有效' },
  { orderId: 'ORD-20260913', bizDate: '2026-09-14', postDate: '2026-09-15', region: '华东', category: '电子产品', channel: '线上', amount: 2400, status: '有效' },
  { orderId: 'ORD-20260914', bizDate: '2026-09-15', postDate: '2026-09-16', region: '华南', category: '食品饮料', channel: '线下', amount: 700, status: '有效' },
  { orderId: 'ORD-20260915', bizDate: '2026-09-16', postDate: '2026-09-17', region: '华北', category: '电子产品', channel: '线上', amount: 1750, status: '有效' },
  { orderId: 'ORD-20260916', bizDate: '2026-09-17', postDate: '2026-09-18', region: '西南', category: '办公用品', channel: '线下', amount: 560, status: '有效' },
  { orderId: 'ORD-20260917', bizDate: '2026-09-18', postDate: '2026-09-19', region: '华中', category: '家居用品', channel: '线上', amount: 1100, status: '有效' },
  { orderId: 'ORD-20260918', bizDate: '2026-09-19', postDate: '2026-09-20', region: '华东', category: '办公用品', channel: '线下', amount: 480, status: '有效' },
  { orderId: 'ORD-20260919', bizDate: '2026-09-20', postDate: '2026-09-21', region: '华南', category: '电子产品', channel: '线上', amount: 2800, status: '有效' },
  { orderId: 'ORD-20260920', bizDate: '2026-09-21', postDate: '2026-09-22', region: '华北', category: '家居用品', channel: '线下', amount: 950, status: '有效' },
  { orderId: 'ORD-20260921', bizDate: '2026-09-22', postDate: '2026-09-23', region: '西南', category: '食品饮料', channel: '线上', amount: 420, status: '有效' },
  { orderId: 'ORD-20260922', bizDate: '2026-09-23', postDate: '2026-09-24', region: '华中', category: '办公用品', channel: '线下', amount: 760, status: '有效' },
  { orderId: 'ORD-20260923', bizDate: '2026-09-24', postDate: '2026-09-25', region: '西北', category: '电子产品', channel: '线上', amount: 680, status: '有效' },
  { orderId: 'ORD-20260924', bizDate: '2026-09-25', postDate: '2026-09-26', region: '东北', category: '家居用品', channel: '线下', amount: 520, status: '有效' },
  { orderId: 'ORD-20260925', bizDate: '2026-09-26', postDate: '2026-09-27', region: '华东', category: '食品饮料', channel: '线上', amount: 360, status: '有效' },
  { orderId: 'ORD-20260926', bizDate: '2026-09-27', postDate: '2026-09-28', region: '华南', category: '家居用品', channel: '线下', amount: 1250, status: '有效' },
  { orderId: 'ORD-20260927', bizDate: '2026-09-28', postDate: '2026-09-29', region: '华北', category: '办公用品', channel: '线上', amount: 540, status: '有效' },
  { orderId: 'ORD-20260928', bizDate: '2026-09-29', postDate: '2026-09-30', region: '西南', category: '电子产品', channel: '线下', amount: 2200, status: '有效' },
  { orderId: 'ORD-20260929', bizDate: '2026-09-30', postDate: '2026-09-30', region: '华中', category: '食品饮料', channel: '线上', amount: 470, status: '有效' },
  { orderId: 'ORD-20260930', bizDate: '2026-09-10', postDate: '2026-09-18', region: '西北', category: '家居用品', channel: '线下', amount: 230, status: '有效' },
  { orderId: 'ORD-20260931', bizDate: '2026-09-14', postDate: '2026-09-25', region: '东北', category: '食品饮料', channel: '线上', amount: 190, status: '有效' },
  { orderId: 'ORD-20260932', bizDate: '2026-09-19', postDate: '2026-09-28', region: '华东', category: '家居用品', channel: '线上', amount: 850, status: '有效' },
  { orderId: 'ORD-20260933', bizDate: '2026-09-22', postDate: '2026-10-03', region: '华南', category: '办公用品', channel: '线下', amount: 410, status: '有效' },
  { orderId: 'ORD-20260934', bizDate: '2026-09-26', postDate: '2026-10-05', region: '华北', category: '电子产品', channel: '线上', amount: 980, status: '有效' },
  { orderId: 'ORD-20260935', bizDate: '2026-09-08', postDate: '2026-09-20', region: '西南', category: '食品饮料', channel: '线下', amount: 0, status: '已取消' },
]
