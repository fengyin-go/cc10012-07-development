/**
 * 验证用 localStorage 垫片：在导入业务 bundle 之前安装，
 * 让 aggregate-store / local-store 走与浏览器一致的持久化分支。
 * 存储后端是进程内 Map，重新 import 模块实例后数据仍在，可模拟「刷新」。
 */
const storage = new Map()

globalThis.window = {
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null
    },
    setItem(key, value) {
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
    clear() {
      storage.clear()
    },
  },
}

export function snapshotKeys() {
  return [...storage.keys()]
}

export function readRaw(key) {
  return storage.get(key)
}
