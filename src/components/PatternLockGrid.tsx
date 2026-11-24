import React, {useCallback, useRef, useState} from 'react';
import {RotateCcw} from 'lucide-react';

interface PatternLockGridProps {
  onComplete: (pattern: string) => void;
  disabled?: boolean;
  darkSurface?: boolean;
  errorState?: boolean;
  helperText?: string;
}

const NODE_COORDS: Array<{id: number; x: number; y: number}> = [
  {id: 1, x: 45, y: 45},
  {id: 2, x: 120, y: 45},
  {id: 3, x: 195, y: 45},
  {id: 4, x: 45, y: 120},
  {id: 5, x: 120, y: 120},
  {id: 6, x: 195, y: 120},
  {id: 7, x: 45, y: 195},
  {id: 8, x: 120, y: 195},
  {id: 9, x: 195, y: 195},
];

const MIDPOINTS: Record<string, number> = {
  '1-3': 2,
  '3-1': 2,
  '4-6': 5,
  '6-4': 5,
  '7-9': 8,
  '9-7': 8,
  '1-7': 4,
  '7-1': 4,
  '2-8': 5,
  '8-2': 5,
  '3-9': 6,
  '9-3': 6,
  '1-9': 5,
  '9-1': 5,
  '3-7': 5,
  '7-3': 5,
};

export const PatternLockGrid: React.FC<PatternLockGridProps> = ({
  onComplete,
  disabled = false,
  darkSurface = false,
  errorState = false,
  helperText,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [pointerPos, setPointerPos] = useState<{x: number; y: number} | null>(null);
  const selectedRef = useRef<number[]>([]);

  const toSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 240,
      y: ((clientY - rect.top) / rect.height) * 240,
    };
  }, []);

  const addNodeIfHit = useCallback((coords: {x: number; y: number}) => {
    for (const node of NODE_COORDS) {
      const dist = Math.hypot(coords.x - node.x, coords.y - node.y);
      if (dist <= 24) {
        const cur = selectedRef.current;
        if (!cur.includes(node.id)) {
          const next = [...cur];
          const prev = cur[cur.length - 1];
          if (prev !== undefined) {
            const mid = MIDPOINTS[`${prev}-${node.id}`];
            if (mid !== undefined && !next.includes(mid)) {
              next.push(mid);
            }
          }
          next.push(node.id);
          selectedRef.current = next;
          setSelected(next);
        }
        break;
      }
    }
  }, []);

  const finishDrawing = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);
    setPointerPos(null);
    const current = selectedRef.current;
    if (current.length > 0) {
      onComplete(current.join('-'));
    }
  }, [drawing, onComplete]);

  const resetPattern = () => {
    selectedRef.current = [];
    setSelected([]);
    setDrawing(false);
    setPointerPos(null);
  };

  const lineStroke = errorState ? '#F43F5E' : '#10B981';

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        className={`relative rounded-2xl border p-2.5 select-none touch-none ${
          darkSurface
            ? 'border-slate-800 bg-slate-950/90'
            : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950'
        }`}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 240 240"
          className="w-56 h-56 sm:w-60 sm:h-60 touch-none cursor-crosshair"
          onPointerDown={(e) => {
            if (disabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            selectedRef.current = [];
            setSelected([]);
            setDrawing(true);
            const pt = toSvgCoords(e.clientX, e.clientY);
            if (pt) {
              setPointerPos(pt);
              addNodeIfHit(pt);
            }
          }}
          onPointerMove={(e) => {
            if (!drawing || disabled) return;
            const pt = toSvgCoords(e.clientX, e.clientY);
            if (pt) {
              setPointerPos(pt);
              addNodeIfHit(pt);
            }
          }}
          onPointerUp={finishDrawing}
          onPointerCancel={finishDrawing}
        >
          {/* Connected segments */}
          {selected.map((nodeId, idx) => {
            if (idx === 0) return null;
            const a = NODE_COORDS.find((n) => n.id === selected[idx - 1]);
            const b = NODE_COORDS.find((n) => n.id === nodeId);
            if (!a || !b) return null;
            return (
              <line
                key={`${a.id}-${b.id}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={lineStroke}
                strokeWidth="5"
                strokeLinecap="round"
                strokeOpacity="0.85"
              />
            );
          })}

          {/* Live trailing line while dragging */}
          {drawing && selected.length > 0 && pointerPos && (() => {
            const last = NODE_COORDS.find((n) => n.id === selected[selected.length - 1]);
            if (!last) return null;
            return (
              <line
                x1={last.x}
                y1={last.y}
                x2={pointerPos.x}
                y2={pointerPos.y}
                stroke={lineStroke}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="5 5"
                strokeOpacity="0.65"
              />
            );
          })()}

          {/* 9 nodes */}
          {NODE_COORDS.map((node) => {
            const activeIdx = selected.indexOf(node.id);
            const active = activeIdx >= 0;
            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={active ? 18 : 14}
                  fill={
                    active
                      ? errorState
                        ? 'rgba(244,63,94,0.2)'
                        : 'rgba(16,185,129,0.22)'
                      : darkSurface
                        ? 'rgba(30,41,59,0.75)'
                        : 'rgba(148,163,184,0.18)'
                  }
                  stroke={
                    active
                      ? lineStroke
                      : darkSurface
                        ? '#334155'
                        : '#CBD5E1'
                  }
                  strokeWidth="2"
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={active ? 7 : 5}
                  fill={
                    active
                      ? lineStroke
                      : darkSurface
                        ? '#94A3B8'
                        : '#64748B'
                  }
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center justify-between gap-3 w-full max-w-[240px] text-[11px]">
        <span className={darkSurface ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}>
          {helperText ||
            (selected.length > 0
              ? `${selected.length} point${selected.length > 1 ? 's' : ''} relié${selected.length > 1 ? 's' : ''}`
              : 'Glissez votre doigt sur au moins 4 points')}
        </span>
        {selected.length > 0 && !disabled && (
          <button
            type="button"
            onClick={resetPattern}
            className="inline-flex items-center gap-1 font-semibold text-emerald-500 hover:underline cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Effacer</span>
          </button>
        )}
      </div>
    </div>
  );
};
