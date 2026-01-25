'use client';

import { useMemo } from 'react';

type NodeDef = {
  id: string;
  x: number;
  y: number;
  label: string | string[];
  variant?: 'step' | 'label';
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

function getNodeDimensions(label: string | string[]) {
  const lines = getTextLines(label);
  const maxLineLength = Math.max(...lines.map(l => l.length));
  const width = maxLineLength * 8 + NODE_PADDING_X * 2;
  const height = lines.length * LINE_HEIGHT + NODE_PADDING_Y * 2;
  return { width, height };
}

function getAnchorPoint(node: NodeDef, side: 'top' | 'bottom' | 'left' | 'right') {
  const { width, height } = getNodeDimensions(node.label);
  const cx = node.x + width / 2;
  const cy = node.y + height / 2;
  
  switch (side) {
    case 'top': return { x: cx, y: node.y };
    case 'bottom': return { x: cx, y: node.y + height };
    case 'left': return { x: node.x, y: cy };
    case 'right': return { x: node.x + width, y: cy };
  }
}

function Node({ node }: { node: NodeDef }) {
  const lines = getTextLines(node.label);
  const { width, height } = getNodeDimensions(node.label);
  
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

function Edge({ edge, nodes }: { edge: EdgeDef; nodes: NodeDef[] }) {
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
  // Auto-calculate dimensions if not provided
  const autoDimensions = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    
    for (const node of nodes) {
      const { width: nw, height: nh } = getNodeDimensions(node.label);
      maxX = Math.max(maxX, node.x + nw + 20);
      maxY = Math.max(maxY, node.y + nh + 20);
    }
    
    return { width: Math.max(width, maxX), height: Math.max(height, maxY) };
  }, [nodes, width, height]);
  
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
          <Edge key={i} edge={edge} nodes={nodes} />
        ))}
        
        {/* Render nodes */}
        {nodes.map(node => (
          <Node key={node.id} node={node} />
        ))}
      </svg>
    </div>
  );
}
