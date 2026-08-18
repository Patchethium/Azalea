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
import { DEFAULT_SYNTHESIS_DELAY_MS, MAX_SYNTHESIS_DELAY_MS } from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import type { TextBlockProps } from "@contexts/text";
import { renderRequestFingerprint } from "$utils";

let synthesisGenerationSequence = 0;

type ActiveSynthesisRequest = {
  blockId: string;
  generationId: number;
  hash: string;
  submitted: boolean;
};

export function useTextBlockSynthesis(props: {
  index: number;
  currentText: Accessor<TextBlockProps>;
  currentPreset: Accessor<Preset | null>;
  currentModifiedQuery: Accessor<AudioQuery | null>;
}) {
  const { config } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const [synthState, setSynthState] = createSignal<SynthesisJobState | "Idle">(
    "Idle",
  );
  let activeSynthesisRequest: ActiveSynthesisRequest | null = null;
  let lastSynthesisSignature: string | null = null;
  let unlistenSynthesis: (() => void) | undefined;
  let disposed = false;

  const cancelSynthesisRequest = (request: ActiveSynthesisRequest | null) => {
    if (request?.submitted) {
      void commands
        .cancelSynthesis(request.blockId, request.generationId)
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

  const submitSynthesis = async (
    request: SynthesisJobRequest,
    activeRequest: ActiveSynthesisRequest,
  ) => {
    if (disposed || activeSynthesisRequest !== activeRequest) return;
    activeRequest.submitted = true;
    const result =
      config.ui.buffer_render && config.ui.nonblocking_synthesis
        ? await commands.synthesizeNonblocking(request)
        : await commands.synthesize(request);
    if (
      disposed ||
      activeSynthesisRequest === null ||
      activeSynthesisRequest.blockId !== activeRequest.blockId
    ) {
      if (result.status === "ok") {
        void commands.cancelSynthesis(
          activeRequest.blockId,
          activeRequest.generationId,
        );
      }
      return;
    }
    if (activeSynthesisRequest !== activeRequest) return;
    if (result.status === "error") {
      setSynthState("Failed");
      console.error(
        "Failed to queue synthesis for block",
        props.index,
        ":",
        result.error,
      );
    }
  };

  let scheduledSynthesis:
    | Scheduled<[SynthesisJobRequest, ActiveSynthesisRequest]>
    | undefined;
  const clearScheduledSynthesis = () => {
    scheduledSynthesis?.clear();
    scheduledSynthesis = undefined;
  };
  const enqueueSynthesis = (
    request: SynthesisJobRequest,
    activeRequest: ActiveSynthesisRequest,
  ) => {
    clearScheduledSynthesis();
    const configuredDelay = untrack(
      () => config.ui.synthesis_delay_ms ?? DEFAULT_SYNTHESIS_DELAY_MS,
    );
    const delay = Math.min(
      Math.max(Math.trunc(configuredDelay), 0),
      MAX_SYNTHESIS_DELAY_MS,
    );
    scheduledSynthesis = debounce(submitSynthesis, delay);
    scheduledSynthesis(request, activeRequest);
  };

  onMount(() => {
    void events.synthesisJobEvent
      .listen(({ payload }) => {
        const activeRequest = activeSynthesisRequest;
        if (
          activeRequest === null ||
          payload.blockId !== activeRequest.blockId ||
          payload.generationId !== activeRequest.generationId ||
          payload.hash !== activeRequest.hash
        ) {
          return;
        }
        setSynthState(payload.state);
        if (payload.state === "Failed") {
          console.error(
            "Synthesis failed for block",
            props.index,
            ":",
            payload.error,
          );
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
    if (!config.ui.buffer_render || query === null || preset === null) {
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

    clearScheduledSynthesis();
    cancelSynthesisRequest(activeSynthesisRequest);
    synthesisGenerationSequence += 1;
    const activeRequest: ActiveSynthesisRequest = {
      blockId,
      generationId: synthesisGenerationSequence,
      hash,
      submitted: false,
    };
    activeSynthesisRequest = activeRequest;
    lastSynthesisSignature = blockSignature;
    setSynthState("Queued");
    enqueueSynthesis(
      {
        blockId,
        generationId: activeRequest.generationId,
        audioQuery: query,
        speakerId,
        hash,
      },
      activeRequest,
    );
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
