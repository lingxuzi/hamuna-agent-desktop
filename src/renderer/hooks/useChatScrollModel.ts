import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Message as MessageType } from '@/types/chat';
import {
  buildMessageLayoutFingerprint,
  estimateMessageRowHeight,
  type RowLayoutContract,
} from '@/utils/chatRowLayout';
import { projectVisibleChatTimelineRows } from '@/utils/chatTimelineRows';

export interface ChatScrollModel {
  data: readonly MessageType[];
  firstItemIndex?: number;
  heightEstimateSeed: number[];
  layoutByMessageId: ReadonlyMap<string, RowLayoutContract>;
}

export interface UseChatScrollModelOptions {
  historyMessages: readonly MessageType[];
  streamingMessage: MessageType | null;
  /**
   * Whether to include the streaming row in the projected `data` array. Default `true`
   * (legacy behaviour) keeps backwards compatibility for downstream consumers like
   * `useChatScrollController` and `QueryNavigator` that treat `messages` as the
   * full visible timeline.
   *
   * Pass `false` when `MessageList` is going to receive the streaming row as a
   * separate prop — the row goes through its own `streamingMessageRef`-driven
   * path in `renderItem`, and merging it into `data` here churns the data array
   * reference on every reveal tick (~30 fps during streaming). That new identity
   * propagates to `MessageList`'s `messages` prop and defeats its `memo`, forcing
   * every visible row's `areMessagesEqual` to run per tick.
   */
  includeStreamingInData?: boolean;
  firstItemIndex?: number;
  sessionId?: string | null;
}

interface HeightEstimateSeedCache {
  sessionId?: string | null;
  orderedIdsKey: string;
  estimatesById: ReadonlyMap<string, number>;
  seed: number[];
}

function getViewportHeight(): number {
  if (typeof window === 'undefined') return 800;
  return window.innerHeight || 800;
}

export function useChatScrollModel({
  historyMessages,
  streamingMessage,
  includeStreamingInData = true,
  firstItemIndex,
  sessionId,
}: UseChatScrollModelOptions): ChatScrollModel {
  const [viewportHeight, setViewportHeight] = useState(getViewportHeight);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      const next = getViewportHeight();
      setViewportHeight(prev => (Math.abs(prev - next) < 80 ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // When the caller is going to feed `streamingMessage` to the list as a separate
  // prop (see `includeStreamingInData`), drop it from `data` so the data array
  // reference stays stable across reveal ticks. Otherwise we get a fresh array
  // identity every tick (the spread in `projectVisibleChatTimelineRows` allocates
  // a new array even when `historyMessages` and `streamingMessage` are referentially
  // identical), which defeats the `MessageList.memo` and forces every visible row
  // to re-run `areMessagesEqual` per tick.
  const data = useMemo(
    () => (includeStreamingInData
      ? projectVisibleChatTimelineRows(historyMessages, streamingMessage)
      : historyMessages),
    [historyMessages, streamingMessage, includeStreamingInData],
  );

  const orderedIdsKey = useMemo(
    () => data.map(message => message.id).join('\u001f'),
    [data],
  );

  const layoutFingerprint = useMemo(
    () => [
      sessionId ?? '',
      data.map(message => buildMessageLayoutFingerprint(message, viewportHeight)).join('\u001f'),
    ].join('\u001e'),
    [data, sessionId, viewportHeight],
  );

  // Per-message RowLayoutContract cache. Identity of every contract stays
  // stable as long as that specific message's fingerprint hasn't changed,
  // even when streaming ticks invalidate siblings' fingerprints. The previous
  // implementation rebuilt the entire Map per tick (O(N) regex over all
  // messages + new Map identity) → MessageList's layoutByMessageId prop
  // flipped every reveal → all visible rows re-rendered. Now only messages
  // whose fingerprint actually changed get a new contract; references for the
  // rest are reused from `contractCacheRef`.
  const contractCacheRef = useRef<Map<string, { fingerprint: string; contract: RowLayoutContract }>>(new Map());
  const layoutByMessageId = useMemo(() => {
    const cache = contractCacheRef.current;
    const nextLayout = new Map<string, RowLayoutContract>();
    let cacheMiss = false;
    for (const message of data) {
      const fingerprint = buildMessageLayoutFingerprint(message, viewportHeight);
      const hit = cache.get(message.id);
      if (hit && hit.fingerprint === fingerprint) {
        nextLayout.set(message.id, hit.contract);
      } else {
        const contract = estimateMessageRowHeight(message, viewportHeight);
        cache.set(message.id, { fingerprint, contract });
        nextLayout.set(message.id, contract);
        cacheMiss = true;
      }
    }
    // Compact cache if it has drifted much larger than the visible window —
    // entries for messages that left the visible set would otherwise leak
    // across session switches. Bound to ticks where the cache grew, so
    // steady-state streaming doesn't pay an O(N) walk every reveal.
    if (cacheMiss && cache.size > nextLayout.size * 2) {
      for (const id of cache.keys()) {
        if (!nextLayout.has(id)) cache.delete(id);
      }
    }
    return nextLayout;
    // `layoutFingerprint` is the semantic dependency: token-level streaming
    // changes that stay inside the same line/code/attachment bucket keep the
    // previous live layout while `data` below remains live for rendering/search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutFingerprint, viewportHeight]);

  const heightEstimateSeedCacheRef = useRef<HeightEstimateSeedCache>({
    sessionId,
    orderedIdsKey: '',
    estimatesById: new Map(),
    seed: [],
  });

  const heightEstimateSeedCache = useMemo<HeightEstimateSeedCache>(() => {
    const previous = heightEstimateSeedCacheRef.current;
    if (previous.sessionId === sessionId && previous.orderedIdsKey === orderedIdsKey) {
      return previous;
    }

    const canReusePrevious = previous.sessionId === sessionId;
    const nextEstimatesById = new Map<string, number>();
    const nextSeed = data.map((message) => {
      const cached = canReusePrevious ? previous.estimatesById.get(message.id) : undefined;
      const estimate = cached ?? estimateMessageRowHeight(message, viewportHeight).estimatedHeight;
      nextEstimatesById.set(message.id, estimate);
      return estimate;
    });

    return {
      sessionId,
      orderedIdsKey,
      estimatesById: nextEstimatesById,
      seed: nextSeed,
    };
  }, [data, orderedIdsKey, sessionId, viewportHeight]);

  useLayoutEffect(() => {
    heightEstimateSeedCacheRef.current = heightEstimateSeedCache;
  }, [heightEstimateSeedCache]);

  return {
    data,
    firstItemIndex,
    heightEstimateSeed: heightEstimateSeedCache.seed,
    layoutByMessageId,
  };
}
