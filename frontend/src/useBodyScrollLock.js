import { useEffect } from "react";

// Every modal here is conditionally mounted by its parent (rendered only
// while open), not toggled via an internal prop — so locking on mount and
// restoring on unmount is exactly "while this modal is open".
export function useBodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
}
