import { createCanvasDocument, getCanvasCapabilities, normalizeCanvasDocument } from './canvasSchema.js'

function compactNode(node) {
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId || null,
    title: String(node.data?.title || ''),
    properties: node.data?.properties || {},
    layout: node.data?.layout || null,
    imageMode: node.data?.imageMode || null,
    asset: node.data?.assetName
      ? { name: String(node.data.assetName), source: String(node.data.assetSource || '') }
      : null,
  }
}

export function createCanvasChatContext(value) {
  const document = normalizeCanvasDocument(createCanvasDocument(value || {}))
  return {
    schemaVersion: document.schemaVersion,
    name: document.name,
    rules: document.rules,
    nodes: document.nodes.map(compactNode),
    edges: document.edges.map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle || null,
      target: edge.target,
      targetHandle: edge.targetHandle || null,
    })),
    capabilities: getCanvasCapabilities(),
  }
}
