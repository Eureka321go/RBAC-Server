export interface TreeNode<T = unknown> {
  id: number | string
  parentId?: number | string | null
  children?: T[]
}

export function buildTree<T extends TreeNode<T>>(items: T[]) {
  const nodeMap = new Map<T['id'], T & { children: T[] }>()
  const roots: Array<T & { children: T[] }> = []

  items.forEach((item) => {
    nodeMap.set(item.id, { ...item, children: [...(item.children ?? [])] })
  })

  nodeMap.forEach((node) => {
    if (node.parentId == null || !nodeMap.has(node.parentId)) {
      roots.push(node)
      return
    }

    nodeMap.get(node.parentId)?.children.push(node)
  })

  return roots
}
