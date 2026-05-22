import { useState, useEffect, useRef, useCallback } from "react";

interface UseSessionTimerOptions {
  initialSeconds?: number;
  active?: boolean;
  onTick?: (seconds: number) => void;
  syncIntervalSeconds?: number;
}

export function useSessionTimer({
  initialSeconds = 0,
  active = false,
  onTick,
  syncIntervalSeconds = 10,
}: UseSessionTimerOptions) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const onTickRef = useRef(onTick);
  const syncCounterRef = useRef(0);

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    setSeconds(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        syncCounterRef.current += 1;
        if (syncCounterRef.current >= syncIntervalSeconds) {
          syncCounterRef.current = 0;
          onTickRef.current?.(next);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [active, syncIntervalSeconds]);

  const format = useCallback((s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }, []);

  return { seconds, formatted: format(seconds) };
}
