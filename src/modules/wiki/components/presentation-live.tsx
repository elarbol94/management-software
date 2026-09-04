"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, Radio, RadioTower } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LIVE_SESSION_CODE_LENGTH,
  LIVE_SESSION_HEARTBEAT_MS,
  LIVE_SESSION_POLL_MS,
  liveSessionFollowPath,
  liveSessionPositionSchema,
  normalizeLiveSessionCode,
} from "../lib/live-session";
import {
  publishPresentationLivePosition,
  startPresentationLiveSession,
  stopPresentationLiveSession,
} from "../presentation-live-actions";

/**
 * Remote follow, viewer half: poll the live session and hand each reported stop to
 * `onStep`. Returns whether the session is still running, which is all the caller needs
 * beyond the step itself.
 */
export function usePresentationFollower(code: string | null, onStep: (stepIndex: number) => void) {
  const [live, setLive] = useState(true);

  // The callback is read through a ref, so a caller that rebuilds it does not restart the poll.
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  }, [onStep]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/wiki/presentations/live/${code}`, { cache: "no-store" });
        if (!response.ok) {
          // A deleted session (404) ends the follow rather than freezing on the last stop.
          if (!cancelled && response.status === 404) setLive(false);
          return;
        }
        const parsed = liveSessionPositionSchema.safeParse(await response.json());
        if (!parsed.success || cancelled) return;
        setLive(parsed.data.live);
        onStepRef.current(parsed.data.stepIndex);
      } catch {
        // A dropped poll is not an error worth showing: the next tick retries.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), LIVE_SESSION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [code]);

  return live;
}

/**
 * Remote follow, presenter half: a button that starts a session and then publishes the
 * player's current stop. Publishing is driven by `stepIndex` changing, plus a slow
 * heartbeat so followers can tell a quiet talk from an abandoned one.
 */
export function PresentationLiveControl({
  presentationId,
  stepIndex,
  stopRef,
}: {
  presentationId: string;
  stepIndex: number;
  /** Filled with "end the session I am hosting", for the player to await before it navigates. */
  stopRef: RefObject<(() => Promise<void>) | null>;
}) {
  const t = useTranslations("wiki");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Kept in a ref so the heartbeat interval below is not torn down on every step change.
  const stepRef = useRef(stepIndex);
  useEffect(() => {
    stepRef.current = stepIndex;
  }, [stepIndex]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const publish = async () => {
      try {
        const result = await publishPresentationLivePosition({ presentationId, code, stepIndex: stepRef.current });
        // The session was taken over or stopped elsewhere — drop back to not-live.
        if (!result.live && !cancelled) setCode(null);
      } catch {
        // Same as the follower: the next step change or heartbeat retries.
      }
    };
    void publish();
    const timer = setInterval(() => void publish(), LIVE_SESSION_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [code, presentationId, stepIndex]);

  // Leaving the player has to end the talk, or the session outlives the tab hosting it:
  // followers keep getting `{live:true}` on a frozen stop until the 45s stale window closes,
  // and the presenter re-entering the player is offered "start" over a row that is still
  // live. This is handed to the player rather than run from an unmount cleanup because by
  // unmount time it is too late: Next posts server actions to the *current* document URL,
  // and the editor the player navigates to does not register this action, so a stop sent
  // after `router.push` is answered 200 and silently dropped. The player awaits this first.
  const stop = useCallback(async () => {
    // Scoped to this tab's own code: a restart in another tab has already replaced the row,
    // and that newer session is not ours to end.
    if (!code) return;
    try {
      await stopPresentationLiveSession({ presentationId, code });
    } catch {
      // We are leaving regardless; the heartbeat's staleness window is the fallback.
    }
    setCode(null);
  }, [code, presentationId]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop, stopRef]);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      if (code) {
        await stopPresentationLiveSession({ presentationId, code });
        setCode(null);
      } else {
        const started = await startPresentationLiveSession({ presentationId, stepIndex: stepRef.current });
        setCode(started.code);
      }
    } catch {
      toast.error(t("presentations.liveFailed"));
    } finally {
      setBusy(false);
    }
  }, [code, presentationId, t]);

  const copyLink = useCallback(() => {
    if (!code) return;
    const link = `${window.location.origin}${liveSessionFollowPath(code)}`;
    void navigator.clipboard?.writeText(link).then(
      () => toast.success(t("presentations.liveLinkCopied")),
      () => toast.error(t("presentations.liveFailed")),
    );
  }, [code, t]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={code ? t("presentations.liveStop") : t("presentations.liveStart")}
        aria-pressed={Boolean(code)}
        onClick={() => void toggle()}
      >
        {code ? <RadioTower className="size-4 text-indigo-500" /> : <Radio className="size-4" />}
      </Button>
      {code && (
        <button
          type="button"
          onClick={copyLink}
          title={t("presentations.liveCopyLink")}
          className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-mono text-xs tracking-widest text-indigo-600 dark:text-indigo-300"
        >
          {code}
        </button>
      )}
    </>
  );
}

/**
 * Join by code. The code lives in the follow URL, so this only has to normalise what was
 * typed and navigate — the page behind it does the lookup and the permission check.
 */
export function PresentationJoinForm() {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [value, setValue] = useState("");
  const code = normalizeLiveSessionCode(value);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code) router.push(liveSessionFollowPath(code));
      }}
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value.toUpperCase())}
        maxLength={LIVE_SESSION_CODE_LENGTH + 2}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-label={t("presentations.joinCode")}
        placeholder={t("presentations.joinCodePlaceholder")}
        className="w-40 font-mono tracking-widest uppercase"
      />
      <Button type="submit" disabled={!code}>{t("presentations.joinSubmit")}</Button>
    </form>
  );
}

/**
 * What a follower sees instead of the player controls: whose talk, whether it is still
 * running, and the way out. The exit is a link rather than a keystroke because the player
 * covers the whole viewport and Escape does not exist on a phone.
 */
export function PresentationFollowBadge({ live, hostName }: { live: boolean; hostName: string }) {
  const t = useTranslations("wiki");
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
      <div className="flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
        <span className={`size-2 rounded-full ${live ? "bg-indigo-500" : "bg-muted-foreground"}`} />
        {/* Only the status text is the live region: an announcement should not re-read the
            exit link every time the session flips to ended. */}
        <span role="status" aria-live="polite">
          {live
            ? hostName ? t("presentations.followingHost", { name: hostName }) : t("presentations.following")
            : t("presentations.followEnded")}
        </span>
        <Link className={buttonVariants({ variant: "ghost", size: "xs" })} href="/wiki/presentations/follow">
          <LogOut className="size-3" />
          {t("presentations.leaveFollow")}
        </Link>
      </div>
    </div>
  );
}
