interface MicVisualizerProps {
  isListening: boolean;
  className?: string;
}

export function MicVisualizer({ isListening, className = "" }: MicVisualizerProps) {
  const bars = 7;
  const heights = [4, 8, 14, 18, 14, 8, 4];

  return (
    <div className={`flex items-center gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-current"
          style={{
            height: isListening ? `${heights[i]}px` : "3px",
            animation: isListening
              ? `mic-bar-${i} ${0.7 + i * 0.07}s ease-in-out infinite alternate`
              : "none",
            animationDelay: `${i * 0.06}s`,
            transition: "height 0.3s ease",
          }}
        />
      ))}
      <style>{`
        ${Array.from({ length: bars }, (_, i) => `
          @keyframes mic-bar-${i} {
            0%   { height: ${Math.max(3, heights[i] - 10)}px; opacity: 0.5; }
            100% { height: ${heights[i] + 6}px; opacity: 1; }
          }
        `).join('')}
      `}</style>
    </div>
  );
}
