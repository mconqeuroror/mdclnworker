import { useEffect, useRef, useState } from "react";

export function CustomCursor() {
  const DOT_SIZE = 16;
  const [enabled, setEnabled] = useState(false);
  const dotRef = useRef(null);
  const stopTimerRef = useRef(null);
  const pressTimerRef = useRef(null);
  const rafRef = useRef(null);
  const posRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Desktop/fine pointer only
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    const applyEnabled = () => setEnabled(mql.matches);
    applyEnabled();
    mql.addEventListener("change", applyEnabled);
    return () => mql.removeEventListener("change", applyEnabled);
  }, []);

  useEffect(() => {
    if (!enabled || !dotRef.current) return undefined;

    const setMovingClass = (isMoving) => {
      if (!dotRef.current) return;
      dotRef.current.classList.toggle("is-moving", isMoving);
    };

    const setPressedClass = (isPressed) => {
      if (!dotRef.current) return;
      dotRef.current.classList.toggle("is-pressed", isPressed);
    };

    const move = (e) => {
      posRef.current = { x: e.clientX, y: e.clientY };
      setMovingClass(true);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = window.setTimeout(() => setMovingClass(false), 70);

      if (!rafRef.current) {
        rafRef.current = window.requestAnimationFrame(() => {
          if (dotRef.current) {
            dotRef.current.style.transform = `translate3d(${posRef.current.x - DOT_SIZE / 2}px, ${posRef.current.y - DOT_SIZE / 2}px, 0)`;
          }
          rafRef.current = null;
        });
      }
    };

    const down = () => {
      setPressedClass(true);
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
      // keep sharp for a beat after click
      pressTimerRef.current = window.setTimeout(() => setPressedClass(false), 90);
    };
    const up = () => setPressedClass(false);

    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mousedown", down, { passive: true });
    window.addEventListener("mouseup", up, { passive: true });

    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={dotRef}
      className="custom-cursor-dot"
      aria-hidden="true"
    />
  );
}

