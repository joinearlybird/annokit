/**
 * Whether the person has asked the OS for less motion.
 *
 * The overlay's two "the agent is working" animations — the pencil button's
 * ring and a working marker's — loop for as long as a task runs, which can be
 * minutes. Under Reduce Motion they hold still instead: the fact is the same,
 * the movement is not needed to state it.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => {
        if (alive) setReduce(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}
