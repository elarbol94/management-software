"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { applyMunicipalityAnalysisOperations } from "../actions";
import type { MunicipalityAnalysisGraphOperation } from "../analysis";

export type MunicipalityAnalysisSaveState = "saved" | "saving" | "error";

type EnqueueOptions = { debounceKey?: string; delay?: number };
/**
 * A whole batch, not one operation: dragging a multiple selection moves every node in it
 * under a single key, and keeping only the last of them would drop the rest on the floor.
 */
type DelayedOperation = { operations: MunicipalityAnalysisGraphOperation[]; timer: number };
type AnalysisQueue = {
  /**
   * Operations that are already in the reader's copy of the graph. They stay in the queue
   * until the server confirms them — dropping them early would lose an edit whenever a
   * navigation renders a server graph saved before the operation landed — but they are
   * handed out for replay only once. Replaying an operation twice stays harmless only
   * while every one of them is idempotent, and editing a node's dataset is not: a Kennzahl
   * whose input has since been unpinned no longer matches, and expands a second time.
   */
  applied: WeakSet<MunicipalityAnalysisGraphOperation>;
  ready: MunicipalityAnalysisGraphOperation[];
  inFlight: MunicipalityAnalysisGraphOperation[];
  optimistic: Array<{ operation: MunicipalityAnalysisGraphOperation; debounceKey?: string }>;
  delayed: Map<string, DelayedOperation>;
  running: boolean;
  retryTimer: number | null;
  failures: number;
  /** Resolved once the queue is empty, so a server action can read the persisted graph. */
  waiters: Array<(drained: boolean) => void>;
};
type PersistenceContextValue = {
  enqueue: (analysisId: string, operations: MunicipalityAnalysisGraphOperation[], options?: EnqueueOptions) => void;
  getPendingOperations: (analysisId: string) => MunicipalityAnalysisGraphOperation[];
  getSaveState: (analysisId: string) => MunicipalityAnalysisSaveState;
  /** Sends everything still queued now and resolves false if it could not be saved. */
  flush: (analysisId: string) => Promise<boolean>;
  markApplied: (analysisId: string, operations: MunicipalityAnalysisGraphOperation[]) => void;
};

const PersistenceContext = createContext<PersistenceContextValue | null>(null);

function settle(queue: AnalysisQueue, drained: boolean) {
  const waiters = queue.waiters.splice(0);
  for (const resolve of waiters) resolve(drained);
}

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
      queue = { applied: new WeakSet(), ready: [], inFlight: [], optimistic: [], delayed: new Map(), running: false, retryTimer: null, failures: 0, waiters: [] };
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
      // Confirmed by the server, so they are no longer what an arriving graph might be
      // missing. Left in place they would grow for as long as the editor is open, and
      // every render walks this list to find what still has to be replayed.
      const confirmed = new Set(queue.inFlight);
      queue.optimistic = queue.optimistic.filter(({ operation }) => !confirmed.has(operation));
      queue.inFlight = [];
      queue.running = false;
      queue.failures = 0;
      if (queue.ready.length > 0) void run(analysisId);
      else if (queue.delayed.size === 0) { publish(analysisId, "saved"); settle(queue, true); }
      else publish(analysisId, "saving");
    } catch {
      queue.ready.unshift(...queue.inFlight);
      queue.inFlight = [];
      queue.running = false;
      queue.failures += 1;
      publish(analysisId, "error");
      settle(queue, false);
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
      const { debounceKey } = options;
      queue.optimistic = [
        ...queue.optimistic.filter((entry) => entry.debounceKey !== debounceKey),
        ...operations.map((operation) => ({ operation, debounceKey })),
      ];
      const existing = queue.delayed.get(debounceKey);
      if (existing) window.clearTimeout(existing.timer);
      const timer = window.setTimeout(() => {
        const delayed = queue.delayed.get(debounceKey);
        if (!delayed || delayed.timer !== timer) return;
        queue.delayed.delete(debounceKey);
        queue.ready.push(...delayed.operations);
        publish(analysisId, "saving");
        void pump(analysisId);
      }, options.delay ?? 500);
      queue.delayed.set(debounceKey, { operations, timer });
      return;
    }
    queue.optimistic.push(...operations.map((operation) => ({ operation })));
    queue.ready.push(...operations);
    void pump(analysisId);
  }, [getQueue, publish, pump]);

  /** Records that these operations are now in the caller's graph and need no replay. */
  const markApplied = useCallback((analysisId: string, operations: MunicipalityAnalysisGraphOperation[]) => {
    const queue = getQueue(analysisId);
    for (const operation of operations) queue.applied.add(operation);
  }, [getQueue]);

  const getPendingOperations = useCallback((analysisId: string) => {
    const queue = queues.current.get(analysisId);
    if (!queue) return [];
    return queue.optimistic.flatMap(({ operation }) => queue.applied.has(operation) ? [] : [operation]);
  }, []);

  const getSaveState = useCallback((analysisId: string) => states.current.get(analysisId) ?? "saved", []);

  /**
   * Saving a node as a Kennzahl reads the graph on the server, so anything still sitting
   * in a debounce timer has to land first. Rather than refusing and asking the reader to
   * try again, promote the delayed operations and wait for the queue to run dry.
   */
  const flush = useCallback((analysisId: string) => {
    const queue = getQueue(analysisId);
    for (const delayed of queue.delayed.values()) {
      window.clearTimeout(delayed.timer);
      queue.ready.push(...delayed.operations);
    }
    queue.delayed.clear();
    if (queue.retryTimer !== null) { window.clearTimeout(queue.retryTimer); queue.retryTimer = null; }
    if (!queue.ready.length && !queue.inFlight.length && !queue.running) return Promise.resolve(true);
    const settled = new Promise<boolean>((resolve) => { queue.waiters.push(resolve); });
    publish(analysisId, "saving");
    void pump(analysisId);
    return settled;
  }, [getQueue, publish, pump]);

  useEffect(() => {
    const active = queues.current;
    return () => {
      for (const queue of active.values()) {
        if (queue.retryTimer !== null) window.clearTimeout(queue.retryTimer);
        for (const delayed of queue.delayed.values()) window.clearTimeout(delayed.timer);
        settle(queue, false);
      }
    };
  }, []);

  const value = { enqueue, getPendingOperations, getSaveState, flush, markApplied };
  return <PersistenceContext.Provider value={value}>{children}</PersistenceContext.Provider>;
}

export function useMunicipalityAnalysisPersistence() {
  const context = useContext(PersistenceContext);
  if (!context) throw new Error("MunicipalityAnalysisPersistenceProvider is missing");
  return context;
}
