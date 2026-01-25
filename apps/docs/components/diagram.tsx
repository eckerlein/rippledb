'use client';

import { useMemo } from 'react';

type AbsolutePosition = { x: number; y: number };

type RelativePosition = {
  relativeTo: string;
  anchor: 'right' | 'left' | 'top' | 'bottom';
  offset?: { x?: number; y?: number };
  alignY?: 'top' | 'center' | 'bottom';
  alignX?: 'left' | 'center' | 'right';
};

type NodeDef = {
  id: string;
  label: string | string[];
  variant?: 'step' | 'label';
} & (AbsolutePosition | RelativePosition);

// Internal resolved node with guaranteed x, y
type ResolvedNode = {
  id: string;
  label: string | string[];
  variant?: 'step' | 'label';
  x: number;
  y: number;
};

type EdgeDef = {
  from: string;
  to: string;
  fromSide?: 'bottom' | 'right' | 'left' | 'top';
  toSide?: 'top' | 'left' | 'right' | 'bottom';
  label?: string;
  dashed?: boolean;
  animated?: boolean;
};

type DiagramProps = {
  nodes: NodeDef[];
  edges: EdgeDef[];
  width?: number;
  height?: number;
};

const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 10;
const LINE_HEIGHT = 18;
const FONT_SIZE = 13;
const ARROW_SIZE = 6;

function getTextLines(label: string | string[]): string[] {
  return Array.isArray(label) ? label : [label];
}

function getNodeDimensions(node: { label: string | string[]; variant?: 'step' | 'label' }) {
  const lines = getTextLines(node.label);
  const maxLineLength = Math.max(...lines.map(l => l.length));
  
  if (node.variant === 'label') {
    // Text label: no padding, just text dimensions
    const width = maxLineLength * 7.5; // monospace char width
    const height = lines.length * LINE_HEIGHT;
    return { width, height };
  }
  
  // Box node: includes padding
  const width = maxLineLength * 8 + NODE_PADDING_X * 2;
  const height = lines.length * LINE_HEIGHT + NODE_PADDING_Y * 2;
  return { width, height };
}

function isRelativePosition(node: NodeDef): node is NodeDef & RelativePosition {
  return 'relativeTo' in node;
}

function resolveNodePositions(nodes: NodeDef[]): ResolvedNode[] {
  const resolved = new Map<string, ResolvedNode>();
  const pending = [...nodes];
  let iterations = 0;
  const maxIterations = nodes.length * 2; // Prevent infinite loops
  
  while (pending.length > 0 && iterations < maxIterations) {
    iterations++;
    const node = pending.shift()!;
    
    if (!isRelativePosition(node)) {
      // Absolute position - resolve immediately
      resolved.set(node.id, {
        id: node.id,
        label: node.label,
        variant: node.variant,
        x: node.x,
        y: node.y,
      });
      continue;
    }
    
    // Relative position - check if reference node is resolved
    const refNode = resolved.get(node.relativeTo);
    if (!refNode) {
      // Reference not yet resolved, push back to pending
      pending.push(node);
      continue;
    }
    
    // Calculate position based on reference node
    const refDims = getNodeDimensions(refNode);
    const thisDims = getNodeDimensions(node);
    const offset = node.offset || {};
    const offsetX = offset.x ?? 0;
    const offsetY = offset.y ?? 0;
    
    let x: number;
    let y: number;
    
    // Base position from anchor
    switch (node.anchor) {
      case 'right':
        x = refNode.x + refDims.width + offsetX;
        y = refNode.y + offsetY;
        break;
      case 'left':
        x = refNode.x - thisDims.width + offsetX;
        y = refNode.y + offsetY;
        break;
      case 'bottom':
        x = refNode.x + offsetX;
        y = refNode.y + refDims.height + offsetY;
        break;
      case 'top':
        x = refNode.x + offsetX;
        y = refNode.y - thisDims.height + offsetY;
        break;
    }
    
    // Apply Y alignment for horizontal anchors (left/right)
    if (node.anchor === 'left' || node.anchor === 'right') {
      const alignY = node.alignY || 'center';
      switch (alignY) {
        case 'top':
          // y already at refNode.y
          break;
        case 'center':
          y = refNode.y + (refDims.height - thisDims.height) / 2 + offsetY;
          break;
        case 'bottom':
          y = refNode.y + refDims.height - thisDims.height + offsetY;
          break;
      }
    }
    
    // Apply X alignment for vertical anchors (top/bottom)
    if (node.anchor === 'top' || node.anchor === 'bottom') {
      const alignX = node.alignX || 'left';
      switch (alignX) {
        case 'left':
          // x already at refNode.x
          break;
        case 'center':
          x = refNode.x + (refDims.width - thisDims.width) / 2 + offsetX;
          break;
        case 'right':
          x = refNode.x + refDims.width - thisDims.width + offsetX;
          break;
      }
    }
    
    resolved.set(node.id, {
      id: node.id,
      label: node.label,
      variant: node.variant,
      x,
      y,
    });
  }
  
  return Array.from(resolved.values());
}

function getAnchorPoint(node: ResolvedNode, side: 'top' | 'bottom' | 'left' | 'right') {
  const { width, height } = getNodeDimensions(node);
  
  if (node.variant === 'label') {
    // For label nodes, anchor relative to text position
    const textTop = node.y;
    const textBottom = node.y + height;
    const textCenterY = node.y + height / 2;
    
    switch (side) {
      case 'top': return { x: node.x, y: textTop };
      case 'bottom': return { x: node.x, y: textBottom };
      case 'left': return { x: node.x, y: textCenterY };
      case 'right': return { x: node.x + width, y: textCenterY };
    }
  }
  
  // Box node anchors
  const cx = node.x + width / 2;
  const cy = node.y + height / 2;
  
  switch (side) {
    case 'top': return { x: cx, y: node.y };
    case 'bottom': return { x: cx, y: node.y + height };
    case 'left': return { x: node.x, y: cy };
    case 'right': return { x: node.x + width, y: cy };
  }
}

function Node({ node }: { node: ResolvedNode }) {
  const lines = getTextLines(node.label);
  const { width, height } = getNodeDimensions(node);
  
  if (node.variant === 'label') {
    // Simple text label, no box
    return (
      <text
        x={node.x}
        y={node.y + FONT_SIZE}
        className="fill-neutral-500 dark:fill-neutral-400"
        fontSize={FONT_SIZE}
        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={node.x} dy={i === 0 ? 0 : LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  
  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={width}
        height={height}
        rx={4}
        className="fill-neutral-100 stroke-neutral-300 dark:fill-neutral-800 dark:stroke-neutral-600"
        strokeWidth={1}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={node.x + width / 2}
          y={node.y + NODE_PADDING_Y + FONT_SIZE + i * LINE_HEIGHT}
          textAnchor="middle"
          className="fill-neutral-700 dark:fill-neutral-200"
          fontSize={FONT_SIZE}
          fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Edge({ edge, nodes }: { edge: EdgeDef; nodes: ResolvedNode[] }) {
  const fromNode = nodes.find(n => n.id === edge.from);
  const toNode = nodes.find(n => n.id === edge.to);
  
  if (!fromNode || !toNode) return null;
  
  const fromSide = edge.fromSide || 'bottom';
  const toSide = edge.toSide || 'top';
  
  const start = getAnchorPoint(fromNode, fromSide);
  const end = getAnchorPoint(toNode, toSide);
  
  // Calculate arrow direction
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const arrowX = end.x - ARROW_SIZE * Math.cos(angle);
  const arrowY = end.y - ARROW_SIZE * Math.sin(angle);
  
  // Arrow points
  const arrowAngle1 = angle + Math.PI * 0.8;
  const arrowAngle2 = angle - Math.PI * 0.8;
  const arrow1X = end.x + ARROW_SIZE * Math.cos(arrowAngle1);
  const arrow1Y = end.y + ARROW_SIZE * Math.sin(arrowAngle1);
  const arrow2X = end.x + ARROW_SIZE * Math.cos(arrowAngle2);
  const arrow2Y = end.y + ARROW_SIZE * Math.sin(arrowAngle2);
  
  const strokeDasharray = edge.dashed ? '4 4' : undefined;
  
  // Label position (midpoint)
  const labelX = (start.x + end.x) / 2;
  const labelY = (start.y + end.y) / 2;
  
  return (
    <g className="stroke-neutral-400 fill-neutral-400 dark:stroke-neutral-500 dark:fill-neutral-500">
      <line
        x1={start.x}
        y1={start.y}
        x2={arrowX}
        y2={arrowY}
        strokeWidth={1}
        strokeDasharray={strokeDasharray}
        className={edge.animated ? 'animate-diagram-dash' : ''}
      />
      <polygon
        points={`${end.x},${end.y} ${arrow1X},${arrow1Y} ${arrow2X},${arrow2Y}`}
        stroke="none"
      />
      {edge.label && (
        <text
          x={labelX + 8}
          y={labelY + 4}
          className="fill-neutral-500 dark:fill-neutral-400"
          stroke="none"
          fontSize={11}
          fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

export function Diagram({ nodes, edges, width = 500, height = 400 }: DiagramProps) {
  // Resolve relative positions
  const resolvedNodes = useMemo(() => resolveNodePositions(nodes), [nodes]);
  
  // Auto-calculate dimensions
  const autoDimensions = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    
    for (const node of resolvedNodes) {
      const { width: nw, height: nh } = getNodeDimensions(node);
      maxX = Math.max(maxX, node.x + nw + 20);
      maxY = Math.max(maxY, node.y + nh + 20);
    }
    
    return { width: Math.max(width, maxX), height: Math.max(height, maxY) };
  }, [resolvedNodes, width, height]);
  
  return (
    <div className="my-4 overflow-x-auto">
      <style>{`
        @keyframes diagram-dash {
          to {
            stroke-dashoffset: -8;
          }
        }
        .animate-diagram-dash {
          animation: diagram-dash 0.5s linear infinite;
        }
      `}</style>
      <svg
        width={autoDimensions.width}
        height={autoDimensions.height}
        viewBox={`0 0 ${autoDimensions.width} ${autoDimensions.height}`}
      >
        {/* Render edges first (behind nodes) */}
        {edges.map((edge, i) => (
          <Edge key={i} edge={edge} nodes={resolvedNodes} />
        ))}
        
        {/* Render nodes */}
        {resolvedNodes.map(node => (
          <Node key={node.id} node={node} />
        ))}
      </svg>
    </div>
  );
}
