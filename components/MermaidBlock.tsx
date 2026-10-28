import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Mermaid flowchart renderer.
 *
 * Parses graph/flowchart sources including `classDef`/`class` lines (plus the
 * `:::class` node suffix) so node fills/strokes/text colors come straight from
 * the authored diagram — matching the look of a real Mermaid render.
 *
 * TD (vertical) sources are drawn as a nested tree: branches split into
 * columns with connecting arrows; cycles/back-links are listed below. LR keeps
 * a horizontal chain. A preview button renders the diagram with the real
 * mermaid.js engine via HtmlPreview.
 */

type NodeShape = 'rect' | 'round' | 'diamond' | 'circle';

interface NodeStyle {
  fill?: string;
  stroke?: string;
  color?: string;
}

interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
  style?: NodeStyle;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

interface Diagram {
  direction: 'TD' | 'LR';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Root node ids (the top of the drawn tree). */
  roots: string[];
  /** Node id → tree children (drawn below with arrows). */
  childrenOf: (id: string) => string[];
  /** Label text for a drawn edge, if any. */
  edgeLabel: (from: string, to: string) => string | undefined;
  /** Edges not drawn as arrows (cycles / back-links). */
  skippedEdges: DiagramEdge[];
}

const CLASSDEF_RE = /^classDef\s+([A-Za-z0-9_-]+)\s+(.+)$/;
const CLASS_ASSIGN_RE = /^class\s+([A-Za-z0-9_,\s]+)\s+([A-Za-z0-9_-]+)\s*$/;
const INLINE_CLASS_RE = /:::([A-Za-z0-9_-]+)\s*$/;

function parseStyleDefs(raw: string): NodeStyle {
  const style: NodeStyle = {};
  for (const pair of raw.split(',')) {
    const [key, ...rest] = pair.split(':');
    const value = rest.join(':').trim();
    if (!key || !value) continue;
    if (key.trim() === 'fill') style.fill = value;
    else if (key.trim() === 'stroke') style.stroke = value;
    else if (key.trim() === 'color') style.color = value;
  }
  return style;
}

const NODE_RE =
  /^([A-Za-z0-9_-]+)\s*(\(\(|\[|\(|\{)([\s\S]*?)(\)\)|\]|\)|\})\s*$/;

function parseNodeToken(
  token: string,
): { id: string; label: string; shape: NodeShape; inlineClass?: string } | null {
  let work = token.trim();
  let inlineClass: string | undefined;
  const inline = INLINE_CLASS_RE.exec(work);
  if (inline) {
    inlineClass = inline[1];
    work = work.slice(0, inline.index).trim();
  }
  const m = NODE_RE.exec(work);
  if (!m) return null;
  const [, id, open, label, close] = m;
  const validClose =
    (open === '((' && close === '))') ||
    (open === '[' && close === ']') ||
    (open === '(' && close === ')') ||
    (open === '{' && close === '}');
  if (!validClose) return null;
  const shape: NodeShape =
    open === '[' ? 'rect' : open === '{' ? 'diamond' : open === '((' ? 'circle' : 'round';
  return { id, label: (label.trim() || id).replace(/"([^"]*)"/, '$1'), shape, inlineClass };
}

export function parseMermaid(source: string): Diagram | null {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));
  if (!lines.length) return null;

  let direction: 'TD' | 'LR' = 'TD';
  if (/^(graph|flowchart)\s+(LR|RL)/.test(lines[0])) direction = 'LR';
  if (/^(graph|flowchart)/.test(lines[0])) lines.shift();

  const classStyles = new Map<string, NodeStyle>();
  const classOf = new Map<string, string>();
  const nodeMap = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  const ensureNode = (token: string): string => {
    const parsed = parseNodeToken(token);
    if (parsed) {
      if (!nodeMap.has(parsed.id)) {
        nodeMap.set(parsed.id, { id: parsed.id, label: parsed.label, shape: parsed.shape });
      }
      if (parsed.inlineClass) classOf.set(parsed.id, parsed.inlineClass);
      return parsed.id;
    }
    const id = token.trim();
    if (id && !nodeMap.has(id)) nodeMap.set(id, { id, label: id, shape: 'round' });
    return id;
  };

  for (const line of lines) {
    const classDef = CLASSDEF_RE.exec(line);
    if (classDef) {
      classStyles.set(classDef[1], parseStyleDefs(classDef[2].split(/\s*%%\s*/)[0]));
      continue;
    }
    const classAssign = CLASS_ASSIGN_RE.exec(line);
    if (classAssign) {
      for (const id of classAssign[1].split(/[\s,]+/).filter(Boolean)) {
        classOf.set(id, classAssign[2]);
      }
      continue;
    }
    const m =
      line.match(/^(.+?)\s*(?:-->|-\.->|==>)\|([^|]+)\|\s*(.+)$/) ??
      line.match(/^(.+?)\s*(?:-->|-\.->|==>)\s*(.+)$/);
    if (m) {
      if (m.length === 4) {
        const from = ensureNode(m[1]);
        const to = ensureNode(m[3]);
        if (from && to) edges.push({ from, to, label: m[2].trim() });
      } else {
        const from = ensureNode(m[1]);
        const to = ensureNode(m[2]);
        if (from && to) edges.push({ from, to });
      }
      continue;
    }
    ensureNode(line);
  }

  const nodes = [...nodeMap.values()].map((n) => ({
    ...n,
    style: classOf.has(n.id) ? classStyles.get(classOf.get(n.id) as string) : undefined,
  }));
  if (!nodes.length) return null;

  // Tree layout: BFS from root nodes (no incoming edges). Nodes reached a
  // second time (cycles, cross-links) are skipped as drawn arrows and listed.
  const incoming = new Set<string>();
  for (const e of edges) incoming.add(e.to);
  const children = new Map<string, string[]>();
  const drawn = new Set<string>();
  const roots: string[] = [];
  const queue: string[] = [];

  for (const n of nodes) {
    if (!incoming.has(n.id)) {
      roots.push(n.id);
      queue.push(n.id);
      drawn.add(n.id);
    }
  }
  if (!roots.length) {
    roots.push(nodes[0].id);
    queue.push(nodes[0].id);
    drawn.add(nodes[0].id);
  }
  while (queue.length) {
    const current = queue.shift() as string;
    for (const e of edges.filter((edge) => edge.from === current)) {
      if (e.to === current) continue; // self-loop
      if (drawn.has(e.to)) continue; // cycle or cross-link → listed, not drawn
      const list = children.get(current) ?? [];
      list.push(e.to);
      children.set(current, list);
      drawn.add(e.to);
      queue.push(e.to);
    }
  }

  const childrenOf = (id: string): string[] => children.get(id) ?? [];
  const edgeLabel = (from: string, to: string): string | undefined =>
    edges.find((e) => e.from === from && e.to === to)?.label;
  const skippedEdges = edges.filter((e) => !childrenOf(e.from).includes(e.to));

  return { direction, nodes, edges, roots, childrenOf, edgeLabel, skippedEdges };
}

function shapeRadius(shape: NodeShape): number {
  return shape === 'circle' ? 40 : shape === 'round' ? 16 : 10;
}

export function MermaidBlock({
  source,
  onPreview,
}: {
  source: string;
  onPreview?: (html: string) => void;
}) {
  const colors = useColors();
  const [selected, setSelected] = useState<string | null>(null);
  const diagram = useMemo(() => parseMermaid(source), [source]);

  // Full-fidelity preview: the authentic mermaid.js render (classDefs included).
  const previewHtml = useMemo(
    () =>
      [
        '<!DOCTYPE html><html><head><meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        '<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>',
        '<style>html,body{margin:0;padding:14px;background:#0d1117;}',
        'body{font-family:system-ui,-apple-system,sans-serif;}',
        '.mermaid{display:flex;justify-content:center;overflow:auto;}',
        '.mermaid svg{max-width:100%;height:auto;}</style></head><body>',
        '<pre class="mermaid">',
        source.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        '</pre>',
        '<script>mermaid.initialize({ startOnLoad: true, theme: "dark",',
        'securityLevel: "loose", flowchart: { useMaxWidth: true } });</script>',
        '</body></html>',
      ].join(''),
    [source],
  );

  if (!diagram) {
    // Not a flowchart we can draw — fall back to a copyable code block look.
    return (
      <View style={styles.fallback}>
        <Feather name="git-branch" size={13} color={colors.mutedForeground} />
        <Text style={[styles.fallbackText, { color: colors.mutedForeground }]} selectable>
          {source.trim()}
        </Text>
      </View>
    );
  }

  const { direction, nodes, roots, childrenOf, edgeLabel, skippedEdges } = diagram;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Column width of a node = weight of its whole branch (for even spreading).
  const weights = new Map<string, number>();
  const weightOf = (id: string): number => {
    const cached = weights.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf(id);
    const weight = kids.length
      ? Math.max(1, kids.reduce((sum, k) => sum + weightOf(k), 0))
      : 1;
    weights.set(id, weight);
    return weight;
  };
  for (const root of roots) weightOf(root);

  const relatedEdges = selected
    ? diagram.edges.filter((e) => e.from === selected || e.to === selected)
    : [];

  const renderNode = (id: string): React.ReactNode => {
    const node = nodeById.get(id);
    if (!node) return null;
    const isSel = selected === id;
    const kids = childrenOf(id);
    const stroke = node.style?.stroke ?? (isSel ? colors.primary : colors.border);
    const fill = node.style?.fill ?? colors.card;
    const text = node.style?.color ?? colors.foreground;
    return (
      <View key={id} style={direction === 'LR' ? styles.chainSlot : styles.treeColumn}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`عقدة ${node.label}`}
          onPress={() => setSelected(isSel ? null : id)}
          style={[
            styles.node,
            {
              borderRadius: shapeRadius(node.shape),
              borderColor: stroke,
              borderWidth: 1.5,
              backgroundColor: fill,
            },
          ]}
        >
          {node.shape === 'diamond' ? (
            <Feather name="triangle" size={11} color={stroke} />
          ) : node.shape === 'circle' ? (
            <Feather name="circle" size={11} color={stroke} />
          ) : null}
          <Text numberOfLines={3} style={[styles.nodeLabel, { color: text }]}>
            {node.label}
          </Text>
        </Pressable>

        {kids.length ? (
          direction === 'LR' ? (
            <View style={styles.chainArrow}>
              <Feather name="arrow-left" size={14} color={colors.mutedForeground} />
            </View>
          ) : (
            <View style={styles.treeArrow}>
              <Feather name="arrow-down" size={14} color={colors.mutedForeground} />
              {kids.length === 1 && edgeLabel(id, kids[0]) ? (
                <Text style={[styles.edgeLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {edgeLabel(id, kids[0])}
                </Text>
              ) : null}
            </View>
          )
        ) : null}

        {kids.length ? (
          <View style={direction === 'LR' ? styles.chainRow : styles.childrenRow}>
            {direction === 'LR'
              ? null
              : kids.map((kid) => (
                  <View key={kid} style={[styles.treeCell, { flex: weightOf(kid) }]}>
                    {renderNode(kid)}
                  </View>
                ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.wrap, { borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="git-branch" size={13} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary, flex: 1 }]}>
          مخطط ({direction === 'LR' ? 'أفقي' : 'رأسي'}) — اضغط أي عقدة
        </Text>
        {onPreview ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="معاينة الرسم كاملة"
            onPress={() => onPreview(previewHtml)}
            style={[styles.previewBtn, { borderColor: colors.border }]}
            hitSlop={4}
          >
            <Feather name="monitor" size={13} color={colors.primary} />
            <Text style={[styles.previewBtnText, { color: colors.primary }]}>معاينة كاملة</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={direction === 'LR' ? styles.chainRow : styles.treeRootsRow}>
          {roots.map((root) => renderNode(root))}
        </View>
      </ScrollView>

      {skippedEdges.length ? (
        <View style={[styles.edgeList, { borderTopColor: colors.border }]}>
          {skippedEdges.slice(0, 8).map((e, idx) => (
            <Text key={idx} style={[styles.edgeText, { color: colors.mutedForeground }]}>
              {e.label ? `${e.label}: ` : ''}
              {nodeById.get(e.from)?.label ?? e.from} ← {nodeById.get(e.to)?.label ?? e.to}
            </Text>
          ))}
        </View>
      ) : null}

      {selected && relatedEdges.length ? (
        <View style={[styles.edgeList, { borderTopColor: colors.border }]}>
          {relatedEdges.map((e, idx) => (
            <Text key={idx} style={[styles.edgeText, { color: colors.primary }]} selectable>
              {(nodeById.get(e.from)?.label ?? e.from)}
              {e.label ? ` ${e.label} ` : ' '}→ {(nodeById.get(e.to)?.label ?? e.to)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 14, marginTop: 8, marginBottom: 8, padding: 10 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginBottom: 10 },
  title: { fontSize: 11, fontWeight: '700' },
  previewBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewBtnText: { fontSize: 10.5, fontWeight: '800' },
  treeRootsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  treeColumn: { alignItems: 'center' },
  treeArrow: { alignItems: 'center', paddingVertical: 4, flexDirection: 'row-reverse', gap: 3 },
  edgeLabel: { fontSize: 9.5, fontWeight: '700' },
  childrenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  treeCell: { minWidth: 70 },
  chainRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  chainSlot: { alignItems: 'center' },
  chainArrow: { paddingVertical: 4 },
  node: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    maxWidth: 160,
    minWidth: 64,
  },
  nodeLabel: { fontSize: 11, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  edgeList: { borderTopWidth: 1, marginTop: 10, paddingTop: 8, gap: 4 },
  edgeText: { fontSize: 11, textAlign: 'right' },
  fallback: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    marginTop: 8,
  },
  fallbackText: { flex: 1, fontSize: 11, fontFamily: 'monospace', writingDirection: 'ltr' },
});
