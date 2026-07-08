import type { Directive } from 'vue'
import { usePermissionStore } from '@/stores/permission'

const permission: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    const permissionStore = usePermissionStore()
    const value = binding.value
    const allowed = Array.isArray(value)
      ? permissionStore.hasAnyPermission(value)
      : permissionStore.hasPermission(value)

    if (!allowed) {
      el.remove()
    }
  },
}

export default permission
