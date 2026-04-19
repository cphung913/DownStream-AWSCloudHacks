import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 550): number {
  const [display, setDisplay] = useState(target);
  const from = useRef(target);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (from.current === target) return;
    const start = from.current;
    const t0 = performance.now();

    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      // ease-out cubic
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(start + (target - start) * eased));
      if (p < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        from.current = target;
      }
    };

    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    };
  }, [target, duration]);

  return display;
}
