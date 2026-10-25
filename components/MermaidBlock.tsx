import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Interactive renderer for mermaid flowcharts (graph TD/LR) with custom styled
 * nodes: [rect] (rounded) {diamond} ((circle)). Tapping a node selects it and
 * highlights its edges — a lightweight architecture-diagram view that works
 * inside React Native without a browser engine.
 */

type NodeShape = 'rect' | 'round' | 'diamond' | 'circle';

interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

const NODE_RE =
  /^([A-Za-z0-9_-]+)\s*(\(\(|\[|\(|\{)([\s\S]*?)(\)\)|\]|\)|\})\s*$/;

function parseNode(token: string): { id: string; label: string; shape: NodeShape } | null {
  const m = NODE_RE.exec(token.trim());
  if (!m) return null;
  const [, id, open, label, close] = m;
  // Matching close bracket per opener; anything else is not a node.
  const validClose =
    (open === '((' && close === '))') ||
    (open === '[' && close === ']') ||
    (open === '(' && close === ')') ||
    (open === '{' && close === '}');
  if (!validClose) return null;
  const shape: NodeShape =
    open === '[' ? 'rect' : open === '{' ? 'diamond' : open === '((' ? 'circle' : 'round';
  return { id, label: label.trim() || id, shape };
}

export function parseMermaid(source: string): {
  direction: 'TD' | 'LR';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
} | null {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));
  if (!lines.length) return null;

  let direction: 'TD' | 'LR' = 'TD';
  if (/^(graph|flowchart)\s+(LR|RL)/.test(lines[0])) direction = 'LR';
  if (/^(graph|flowchart)/.test(lines[0])) lines.shift();

  const nodeMap = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  const ensureNode = (token: string): string => {
    const parsed = parseNode(token);
    if (parsed) {
      if (!nodeMap.has(parsed.id)) nodeMap.set(parsed.id, parsed);
      return parsed.id;
    }
    const id = token.trim();
    if (id && !nodeMap.has(id)) nodeMap.set(id, { id, label: id, shape: 'round' });
    return id;
  };

  for (const line of lines) {
    // Edge with label:  A -->|text| B   /   plain:  A --> B
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
    const single = parseNode(line);
    if (single && !nodeMap.has(single.id)) nodeMap.set(single.id, single);
  }

  if (!nodeMap.size) return null;
  return { direction, nodes: [...nodeMap.values()], edges };
}

function shapeStyle(shape: NodeShape): number {
  return shape === 'circle' ? 40 : shape === 'round' ? 16 : 10;
}

export function MermaidBlock({ source }: { source: string }) {
  const colors = useColors();
  const [selected, setSelected] = useState<string | null>(null);
  const diagram = useMemo(() => parseMermaid(source), [source]);

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

  const { direction, nodes, edges } = diagram;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const connectedToSelected = new Set<string>();
  if (selected) {
    connectedToSelected.add(selected);
    for (const e of edges) {
      if (e.from === selected) connectedToSelected.add(e.to);
      if (e.to === selected) connectedToSelected.add(e.from);
    }
  }

  const relatedEdges = selected
    ? edges.filter((e) => e.from === selected || e.to === selected)
    : [];

  return (
    <View style={[styles.wrap, { borderColor: colors.border }]}>
      <View style={styles.header}>
        <Feather name="git-branch" size={13} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary }]}>
          مخطط تفاعلي ({direction === 'LR' ? 'أفقي' : 'رأسي'}) — اضغط عقدة لإبراز اتصالاتها
        </Text>
      </View>
      <ScrollView horizontal={direction === 'LR'} showsHorizontalScrollIndicator={false}>
        <View style={[direction === 'LR' ? styles.rowsLR : styles.rowsTD]}>
          {nodes.map((node, i) => {
            const dim = selected ? !connectedToSelected.has(node.id) : false;
            const isSel = selected === node.id;
            const shapeColor =
              node.shape === 'diamond'
                ? colors.warning
                : node.shape === 'circle'
                  ? colors.success
                  : colors.primary;
            return (
              <View key={node.id} style={styles.nodeSlot}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`عقدة ${node.label}`}
                  onPress={() => setSelected(isSel ? null : node.id)}
                  style={[
                    styles.node,
                    {
                      borderRadius: shapeStyle(node.shape),
                      borderColor: isSel ? shapeColor : colors.border,
                      backgroundColor: isSel ? shapeColor + '22' : colors.card,
                      opacity: dim ? 0.35 : 1,
                      transform: [{ rotate: node.shape === 'diamond' ? '0deg' : '0deg' }],
                    },
                  ]}
                >
                  {node.shape === 'diamond' ? (
                    <Feather name="triangle" size={11} color={shapeColor} />
                  ) : node.shape === 'circle' ? (
                    <Feather name="circle" size={11} color={shapeColor} />
                  ) : null}
                  <Text
                    numberOfLines={2}
                    style={[styles.nodeLabel, { color: colors.foreground }]}
                  >
                    {node.label}
                  </Text>
                </Pressable>
                {i < nodes.length - 1 ? (
                  <Feather
                    name={direction === 'LR' ? 'arrow-left' : 'arrow-down'}
                    size={14}
                    color={colors.mutedForeground}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
      {selected && relatedEdges.length ? (
        <View style={[styles.edgeList, { borderTopColor: colors.border }]}>
          {relatedEdges.map((e, idx) => (
            <Text key={idx} style={[styles.edgeText, { color: colors.mutedForeground }]}>
              {(nodeById.get(e.from)?.label ?? e.from)} ← {e.label ? `${e.label} → ` : '→ '}
              {nodeById.get(e.to)?.label ?? e.to}
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
  rowsTD: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  rowsLR: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  nodeSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  node: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 240,
    alignSelf: 'flex-start',
  },
  nodeLabel: { fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
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
