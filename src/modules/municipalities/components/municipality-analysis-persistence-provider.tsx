"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { applyMunicipalityAnalysisOperations } from "../actions";
import type { MunicipalityAnalysisGraphOperation } from "../analysis";

export type MunicipalityAnalysisSaveState = "saved" | "saving" | "error";

type EnqueueOptions = { debounceKey?: string; delay?: number };
type DelayedOperation = { operation: MunicipalityAnalysisGraphOperation; timer: number };
type AnalysisQueue = {
  ready: MunicipalityAnalysisGraphOperation[];
  inFlight: MunicipalityAnalysisGraphOperation[];
  optimistic: Array<{ operation: MunicipalityAnalysisGraphOperation; debounceKey?: string }>;
  delayed: Map<string, DelayedOperation>;
  running: boolean;
  retryTimer: number | null;
  failures: number;
};
type PersistenceContextValue = {
  enqueue: (analysisId: string, operations: MunicipalityAnalysisGraphOperation[], options?: EnqueueOptions) => void;
  getPendingOperations: (analysisId: string) => MunicipalityAnalysisGraphOperation[];
  getSaveState: (analysisId: string) => MunicipalityAnalysisSaveState;
};

const PersistenceContext = createContext<PersistenceContextValue | null>(null);

export function MunicipalityAnalysisPersistenceProvider({ children }: { children: React.ReactNode }) {
  const queues = useRef(new Map<string, AnalysisQueue>());
  const states = useRef(new Map<string, MunicipalityAnalysisSaveState>());
  const [, setRevision] = useState(0);

  const publish = useCallback((analysisId: string, state?: MunicipalityAnalysisSaveState) => {
    if (state) states.current.set(analysisId, state);
    setRevision((current) => current + 1);
  }, []);

  const getQueue = useCallback((analysisId: string) => {
    let queue = queues.current.get(analysisId);
    if (!queue) {
      queue = { ready: [], inFlight: [], optimistic: [], delayed: new Map(), running: false, retryTimer: null, failures: 0 };
      queues.current.set(analysisId, queue);
    }
    return queue;
  }, []);

  const pump = useCallback(async function run(analysisId: string) {
    const queue = getQueue(analysisId);
    if (queue.running || queue.ready.length === 0) return;
    queue.running = true;
    queue.inFlight = queue.ready.splice(0);
    publish(analysisId, "saving");
    try {
      await applyMunicipalityAnalysisOperations({ analysisId, operations: queue.inFlight });
      queue.inFlight = [];
      queue.running = false;
      queue.failures = 0;
      if (queue.ready.length > 0) void run(analysisId);
      else if (queue.delayed.size === 0) publish(analysisId, "saved");
      else publish(analysisId, "saving");
    } catch {
      queue.ready.unshift(...queue.inFlight);
      queue.inFlight = [];
      queue.running = false;
      queue.failures += 1;
      publish(analysisId, "error");
      const delay = Math.min(5_000, 1_000 * 2 ** Math.min(queue.failures - 1, 3));
      queue.retryTimer = window.setTimeout(() => {
        queue.retryTimer = null;
        void run(analysisId);
      }, delay);
    }
  }, [getQueue, publish]);

  const enqueue = useCallback((analysisId: string, operations: MunicipalityAnalysisGraphOperation[], options?: EnqueueOptions) => {
    if (operations.length === 0) return;
    const queue = getQueue(analysisId);
    publish(analysisId, "saving");
    if (options?.debounceKey) {
      queue.optimistic = [
        ...queue.optimistic.filter(({ debounceKey }) => debounceKey !== options.debounceKey),
        { operation: operations.at(-1)!, debounceKey: options.debounceKey },
      ];
      const existing = queue.delayed.get(options.debounceKey);
      if (existing) window.clearTimeout(existing.timer);
      const operation = operations.at(-1)!;
      const timer = window.setTimeout(() => {
        const delayed = queue.delayed.get(options.debounceKey!);
        if (!delayed || delayed.timer !== timer) return;
        queue.delayed.delete(options.debounceKey!);
        queue.ready.push(delayed.operation);
        publish(analysisId, "saving");
        void pump(analysisId);
      }, options.delay ?? 500);
      queue.delayed.set(options.debounceKey, { operation, timer });
      return;
    }
    queue.optimistic.push(...operations.map((operation) => ({ operation })));
    queue.ready.push(...operations);
    void pump(analysisId);
  }, [getQueue, publish, pump]);

  const getPendingOperations = useCallback((analysisId: string) => {
    const queue = queues.current.get(analysisId);
    if (!queue) return [];
    return queue.optimistic.map(({ operation }) => operation);
  }, []);

  const getSaveState = useCallback((analysisId: string) => states.current.get(analysisId) ?? "saved", []);

  useEffect(() => () => {
    for (const queue of queues.current.values()) {
      if (queue.retryTimer !== null) window.clearTimeout(queue.retryTimer);
      for (const delayed of queue.delayed.values()) window.clearTimeout(delayed.timer);
    }
  }, []);

  const value = { enqueue, getPendingOperations, getSaveState };
  return <PersistenceContext.Provider value={value}>{children}</PersistenceContext.Provider>;
}

export function useMunicipalityAnalysisPersistence() {
  const context = useContext(PersistenceContext);
  if (!context) throw new Error("MunicipalityAnalysisPersistenceProvider is missing");
  return context;
}
