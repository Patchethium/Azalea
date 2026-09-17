import {
  type AudioQuery,
  commands,
  events,
  type Preset,
  type SynthesisJobRequest,
  type SynthesisJobState,
} from "$binding";
import { debounce, type Scheduled } from "@solid-primitives/scheduled";
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import {
  DEFAULT_SYNTHESIS_DELAY_MS,
  MAX_SYNTHESIS_DELAY_MS,
  MAX_RENDER_ATTEMPTS,
  RENDER_RETRY_DELAY_MS,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { type TextBlockProps, useTextStore } from "@contexts/text";
import { renderRequestFingerprint } from "$utils";

let synthesisGenerationSequence = 0;

type ActiveSynthesisRequest = {
  request: SynthesisJobRequest;
  attempt: number;
  submitted: boolean;
  settled: boolean;
};

export function useTextBlockSynthesis(props: {
  index: number;
  currentText: Accessor<TextBlockProps>;
  currentPreset: Accessor<Preset | null>;
  currentModifiedQuery: Accessor<AudioQuery | null>;
}) {
  const { config } = useConfigStore()!;
  const { queryPending } = useTextStore()!;
  const { t1 } = usei18n()!;
  const [synthState, setSynthState] = createSignal<SynthesisJobState | "Idle">(
    "Idle",
  );
  let activeSynthesisRequest: ActiveSynthesisRequest | null = null;
  let lastSynthesisSignature: string | null = null;
  let unlistenSynthesis: (() => void) | undefined;
  let listenerReady: Promise<void> = Promise.resolve();
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelSynthesisRequest = (request: ActiveSynthesisRequest | null) => {
    clearTimeout(retryTimer);
    if (request?.submitted) {
      void commands
        .cancelSynthesis(request.request.blockId, request.request.generationId)
        .then((result) => {
          if (result.status === "error") {
            console.error(
              "Failed to cancel synthesis for block",
              props.index,
              ":",
              result.error,
            );
          }
        });
    }
  };

  const retrySynthesis = (activeRequest: ActiveSynthesisRequest) => {
    if (
      disposed ||
      activeSynthesisRequest !== activeRequest ||
      activeRequest.settled
    )
      return;
    activeRequest.settled = true;
    setSynthState("Failed");
    if (activeRequest.attempt >= MAX_RENDER_ATTEMPTS) return;
    retryTimer = setTimeout(() => {
      const next: ActiveSynthesisRequest = {
        request: {
          ...activeRequest.request,
          generationId: ++synthesisGenerationSequence,
        },
        attempt: activeRequest.attempt + 1,
        submitted: false,
        settled: false,
      };
      activeSynthesisRequest = next;
      setSynthState("Queued");
      void submitSynthesis(next.request, next);
    }, RENDER_RETRY_DELAY_MS);
  };

  const submitSynthesis = async (
    request: SynthesisJobRequest,
    activeRequest: ActiveSynthesisRequest,
  ) => {
    if (disposed || activeSynthesisRequest !== activeRequest) return;
    // Submitting before the event listener is attached can lose the worker's
    // Running/Completed events, leaving the badge stuck on Queued forever.
    await listenerReady;
    if (disposed || activeSynthesisRequest !== activeRequest) return;
    activeRequest.submitted = true;
    try {
      const result =
        config.ui.buffer_render && config.ui.nonblocking_synthesis
          ? await commands.synthesizeNonblocking(request)
          : await commands.synthesize(request);
      if (disposed || activeSynthesisRequest !== activeRequest) {
        if (result.status === "ok") {
          void commands.cancelSynthesis(request.blockId, request.generationId);
        }
        return;
      }
      if (result.status === "error") {
        retrySynthesis(activeRequest);
        console.error(
          "Failed to queue synthesis for block",
          props.index,
          ":",
          result.error,
        );
      }
    } catch (error) {
      retrySynthesis(activeRequest);
      console.error(
        "Failed to queue synthesis for block",
        props.index,
        ":",
        error,
      );
    }
  };

  let scheduledSynthesis:
    | Scheduled<[SynthesisJobRequest, ActiveSynthesisRequest]>
    | undefined;
  let scheduledSynthesisDelay: number | null = null;
  const clearScheduledSynthesis = () => {
    scheduledSynthesis?.clear();
    scheduledSynthesis = undefined;
    scheduledSynthesisDelay = null;
  };
  const enqueueSynthesis = (
    request: SynthesisJobRequest,
    activeRequest: ActiveSynthesisRequest,
  ) => {
    const configuredDelay = untrack(
      () => config.ui.synthesis_delay_ms ?? DEFAULT_SYNTHESIS_DELAY_MS,
    );
    const delay = Math.min(
      Math.max(Math.trunc(configuredDelay), 0),
      MAX_SYNTHESIS_DELAY_MS,
    );
    // Reuse the scheduler across edits unless the configured delay changed.
    if (scheduledSynthesis === undefined || scheduledSynthesisDelay !== delay) {
      clearScheduledSynthesis();
      scheduledSynthesis = debounce(submitSynthesis, delay);
      scheduledSynthesisDelay = delay;
    } else {
      scheduledSynthesis.clear();
    }
    scheduledSynthesis(request, activeRequest);
  };

  onMount(() => {
    listenerReady = events.synthesisJobEvent
      .listen(({ payload }) => {
        const activeRequest = activeSynthesisRequest;
        if (
          activeRequest === null ||
          activeRequest.settled ||
          payload.blockId !== activeRequest.request.blockId ||
          payload.generationId !== activeRequest.request.generationId ||
          payload.hash !== activeRequest.request.hash
        ) {
          return;
        }
        setSynthState(payload.state);
        if (payload.state === "Failed") {
          retrySynthesis(activeRequest);
          console.error(
            "Synthesis failed for block",
            props.index,
            ":",
            payload.error,
          );
        } else if (
          ["Completed", "Cancelled", "Evicted"].includes(payload.state)
        ) {
          activeRequest.settled = true;
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenSynthesis = unlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for synthesis events:", error);
      });
  });

  createEffect(() => {
    const query = props.currentModifiedQuery();
    const preset = props.currentPreset();
    if (
      !config.ui.buffer_render ||
      queryPending[props.currentText().id] ||
      query === null ||
      preset === null
    ) {
      clearScheduledSynthesis();
      cancelSynthesisRequest(activeSynthesisRequest);
      activeSynthesisRequest = null;
      lastSynthesisSignature = null;
      setSynthState("Idle");
      return;
    }

    const blockId = props.currentText().id;
    const speakerId = preset.style_id;
    const { hash, signature } = renderRequestFingerprint(query, speakerId);
    const blockSignature = `${blockId}:${signature}`;
    if (blockSignature === lastSynthesisSignature) return;

    cancelSynthesisRequest(activeSynthesisRequest);
    synthesisGenerationSequence += 1;
    const activeRequest: ActiveSynthesisRequest = {
      request: {
        blockId,
        generationId: synthesisGenerationSequence,
        audioQuery: query,
        speakerId,
        hash,
      },
      attempt: 1,
      submitted: false,
      settled: false,
    };
    activeSynthesisRequest = activeRequest;
    lastSynthesisSignature = blockSignature;
    setSynthState("Queued");
    enqueueSynthesis(activeRequest.request, activeRequest);
  });

  onCleanup(() => {
    disposed = true;
    clearScheduledSynthesis();
    cancelSynthesisRequest(activeSynthesisRequest);
    activeSynthesisRequest = null;
    unlistenSynthesis?.();
  });

  const synthStateText = () => {
    if (props.currentText().query === null || props.currentPreset() === null) {
      return t1("text_block.synth_state.no_query");
    }
    switch (synthState()) {
      case "Idle":
        return t1("text_block.synth_state.not_started");
      case "Queued":
        return t1("text_block.synth_state.queued");
      case "Running":
        return t1("text_block.synth_state.in_progress");
      case "Completed":
        return t1("text_block.synth_state.completed");
      case "Failed":
        return t1("text_block.synth_state.failed");
      case "Cancelled":
        return t1("text_block.synth_state.cancelled");
      case "Evicted":
        return t1("text_block.synth_state.evicted");
      default:
        return t1("text_block.synth_state.no_query");
    }
  };

  const synthStateIcon = () => {
    switch (synthState()) {
      case "Queued":
        return "i-lucide:clock-3";
      case "Running":
        return "i-lucide:loader-circle";
      case "Completed":
        return "i-lucide:check";
      case "Failed":
        return "i-lucide:triangle-alert";
      case "Cancelled":
        return "i-lucide:circle-slash";
      case "Evicted":
        return "i-lucide:archive-restore";
      default:
        return "i-lucide:circle-dashed";
    }
  };

  return { synthState, synthStateText, synthStateIcon };
}
