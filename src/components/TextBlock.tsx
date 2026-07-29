import { Button } from "@kobalte/core/button";
import { debounce, type Scheduled } from "@solid-primitives/scheduled";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  on,
  onCleanup,
  onMount,
  ParentComponent,
  Show,
  splitProps,
  untrack,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import {
  AudioQuery,
  commands,
  events,
  SynthesisJobRequest,
  SynthesisJobState,
} from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import {
  createTextBlock,
  findPresetStyle,
  type TextBlockProps,
  useTextStore,
} from "../contexts/text";
import { useUIStore } from "../contexts/ui";
import { getModifiedQuery } from "../utils";

let synthesisGenerationSequence = 0;

export const synthesisRequestFingerprint = (
  query: AudioQuery,
  speakerId: number,
) => {
  const serialized = JSON.stringify([speakerId, query]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    hash: `${(hash >>> 0).toString(16).padStart(8, "0")}-${serialized.length}`,
    signature: serialized,
  };
};

interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string;
  setText: (text: string) => void;
  focused: boolean;
  placeholder: string;
}

function AutogrowInput(props: ComponentProps) {
  const [local, inputProps] = splitProps(props, [
    "text",
    "setText",
    "focused",
    "placeholder",
  ]);
  let inputRef: HTMLDivElement | undefined;

  createEffect(
    on([() => local.text], () => {
      if (inputRef !== undefined) {
        if (local.text !== inputRef.innerText) {
          inputRef.innerText = local.text;
        }
      }
    }),
  );

  createEffect(() => {
    if (local.focused) inputRef?.focus();
  });

  const handleInput = () => {
    if (inputRef !== undefined) {
      const text = inputRef.innerText === "\n" ? "" : inputRef.innerText;
      local.setText(text);
    }
  };

  return (
    <div class="relative w-full">
      <Show when={local.text === ""}>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 text-slate-4 dark:text-slate-5"
        >
          {local.placeholder}
        </span>
      </Show>
      <div
        contentEditable="plaintext-only"
        class="relative min-h-6 w-full outline-none"
        {...inputProps}
        ref={inputRef}
        onInput={handleInput}
      />
    </div>
  );
}

const EditButton: ParentComponent<{
  edit: () => void;
  disable?: boolean;
}> = (props) => {
  const disabled = createMemo(() => props.disable ?? false);
  return (
    <Button
      class="group h-6 w-6 bg-transparent rounded-md ui-disabled:(cursor-not-allowed)"
      disabled={disabled()}
      onClick={props.edit}
    >
      {props.children}
    </Button>
  );
};

function TextBlock(props: { index: number }) {
  const {
    textStore,
    setTextStore,
    projectPresetStore,
    selectedTextBlockIndex,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { setUIStore } = useUIStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const currentText = createMemo(() => textStore[props.index]);
  const currentQuery = createMemo(() => currentText().query);
  const currentPreset = createMemo(() => {
    if (projectPresetStore.length === 0 || currentText().preset_id === null) {
      return null;
    }
    const preset = projectPresetStore[currentText().preset_id ?? 0];
    return preset !== undefined && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });

  const [hovered, setHovered] = createSignal(false);
  const [toolbarHovered, setToolbarHovered] = createSignal(false);

  const setText = (text: string) => {
    setTextStore(props.index, {
      ...currentText(),
      text,
      query_is_modified: false,
    });
  };

  const setQuery = (query: AudioQuery | null) => {
    setTextStore(
      props.index,
      produce((draft) => {
        draft.query = query;
        draft.query_is_modified = false;
      }),
    );
  };

  const currentPresetStyle = createMemo(() => {
    const curPreset = currentPreset();
    return curPreset === null ? null : findPresetStyle(curPreset, metas);
  });

  let queryRequestRevision = 0;
  let disposed = false;
  const fetchAudioQuery = _.throttle(
    async (
      text: string,
      styleId: number,
      requestRevision: number,
      sourceBlock: TextBlockProps,
    ) => {
      const audio_query = await commands.audioQuery(text, styleId);
      if (
        disposed ||
        requestRevision !== queryRequestRevision ||
        textStore[props.index] !== sourceBlock
      ) {
        return;
      }
      if (audio_query.status === "ok") {
        setQuery(audio_query.data);
      } else {
        console.error(audio_query.error);
      }
    },
    500,
  );

  onCleanup(() => {
    disposed = true;
    queryRequestRevision++;
    fetchAudioQuery.cancel();
  });

  createEffect(
    on(
      [
        () => currentText().id,
        () => currentText().text,
        () => currentPresetStyle()?.style.id,
      ],
      ([blockId, text, styleId], previousInput) => {
        const sourceBlock = currentText();
        const requestRevision = ++queryRequestRevision;
        if (text === "") {
          fetchAudioQuery.cancel();
          setQuery(null);
        } else if (
          (previousInput === undefined || previousInput[0] !== blockId) &&
          sourceBlock.query_is_modified &&
          sourceBlock.query !== null
        ) {
          fetchAudioQuery.cancel();
        } else if (styleId !== undefined) {
          fetchAudioQuery(text, styleId, requestRevision, sourceBlock);
        } else {
          fetchAudioQuery.cancel();
        }
      },
    ),
  );

  const selected = createMemo(() => selectedTextBlockIndex() === props.index);

  const setSelected = (index: number) => {
    setUIStore("selectedTextBlockIndex", index);
  };

  // the toobar actions
  const addTextBelow = () => {
    const nextBlocks = textStore.map((block) => _.cloneDeep(unwrap(block)));
    nextBlocks.splice(
      props.index + 1,
      0,
      createTextBlock(currentText().preset_id),
    );
    setTextStore(nextBlocks);
    // focus on the new text block
    setUIStore("selectedTextBlockIndex", props.index + 1);
  };

  const saveable = createMemo(() => {
    const query = currentQuery();
    if (query === null) return false;
    if (query.accent_phrases.length === 0) return false;
    return true;
  });

  const saveAudio = async () => {
    if (currentPreset() === null) {
      return;
    }
    let file_name = currentText().text;
    const truncation_len = config.ui_config.name_truncation_len;
    // add indication number for overflow length
    if (truncation_len !== 0 && truncation_len !== undefined) {
      file_name = _.truncate(file_name, {
        length: truncation_len ?? 0,
        omission:
          file_name.length < truncation_len
            ? ""
            : `+${(file_name.length - truncation_len).toString()}`,
      });
    }
    const last_saved_dir = config.ui_config.last_exported_dir ?? ".";
    const target_path = await commands.joinPath(last_saved_dir, file_name);
    let path = await saveDialog({
      title: "Save Audio",
      filters: [{ name: "Audio", extensions: ["wav"] }],
      defaultPath: target_path,
    });
    if (path !== null) {
      if (!path.endsWith(".wav")) {
        path = path.concat(".wav");
      }
      const save_audio = await commands.saveAudio(
        path,
        getModifiedQuery(unwrap(currentText().query!), currentPreset()!),
        currentPreset()?.style_id ?? 0,
      );
      if (save_audio.status === "ok") {
        console.log("Audio saved");
        // save last saved directory into config
        const parent = await commands.parentPath(path);
        setConfig("ui_config", "last_exported_dir", parent);
      } else {
        console.error(save_audio.error);
      }
    }
  };

  const moveUp = () => {
    if (props.index > 0) {
      const temp = _.cloneDeep(textStore[props.index - 1]);
      setTextStore(props.index - 1, currentText());
      setTextStore(props.index, temp);
      setSelected(props.index - 1);
    }
  };

  const moveDown = () => {
    if (props.index < textStore.length - 1) {
      const temp = _.cloneDeep(textStore[props.index + 1]);
      setTextStore(props.index + 1, currentText());
      setTextStore(props.index, temp);
      setSelected(props.index + 1);
    }
  };

  const remove = () => {
    // won't remove them all
    if (textStore.length === 1) {
      setTextStore(0, { text: "" });
      return;
    }
    const selectedIndex = selectedTextBlockIndex();
    const remainingBlocks = textStore.filter((_, i) => i !== props.index);
    let nextSelectedIndex = selectedIndex;
    if (selectedIndex === props.index) {
      nextSelectedIndex = props.index === 0 ? 0 : props.index - 1;
    } else if (selectedIndex > props.index) {
      nextSelectedIndex = selectedIndex - 1;
    }
    nextSelectedIndex = Math.min(
      Math.max(nextSelectedIndex, 0),
      remainingBlocks.length - 1,
    );
    batch(() => {
      setTextStore(remainingBlocks);
      setUIStore("selectedTextBlockIndex", nextSelectedIndex);
    });
  };

  const currentModifiedQuery = createMemo(() => {
    const preset = currentPreset();
    const query = currentQuery();
    if (preset === null || query === null) {
      return null;
    }
    return getModifiedQuery(unwrap(query!), preset);
  });

  type ActiveSynthesisRequest = {
    blockId: string;
    generationId: number;
    hash: string;
    submitted: boolean;
  };

  const [synthState, setSynthState] = createSignal<SynthesisJobState | "Idle">(
    "Idle",
  );
  let activeSynthesisRequest: ActiveSynthesisRequest | null = null;
  let lastSynthesisSignature: string | null = null;
  let unlistenSynthesis: (() => void) | undefined;

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
    if (disposed || activeSynthesisRequest !== activeRequest) {
      return;
    }
    activeRequest.submitted = true;
    const result = await commands.synthesize(request);
    if (disposed || activeSynthesisRequest !== activeRequest) {
      if (result.status === "ok") {
        void commands.cancelSynthesis(
          activeRequest.blockId,
          activeRequest.generationId,
        );
      }
      return;
    }
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
      () => config.ui_config.synthesis_delay_ms ?? 600,
    );
    const delay = Math.min(Math.max(Math.trunc(configuredDelay), 0), 10_000);
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
        if (disposed) {
          unlisten();
        } else {
          unlistenSynthesis = unlisten;
        }
      })
      .catch((error) => {
        console.error("Failed to listen for synthesis events:", error);
      });
  });

  createEffect(() => {
    const query = currentModifiedQuery();
    const preset = currentPreset();
    const bufferingEnabled = config.ui_config.buffer_render;
    if (!bufferingEnabled || query === null || preset === null) {
      clearScheduledSynthesis();
      cancelSynthesisRequest(activeSynthesisRequest);
      activeSynthesisRequest = null;
      lastSynthesisSignature = null;
      setSynthState("Idle");
      return;
    }

    const blockId = currentText().id;
    const speakerId = preset.style_id;
    const { hash, signature } = synthesisRequestFingerprint(query, speakerId);
    const blockSignature = `${blockId}:${signature}`;
    if (blockSignature === lastSynthesisSignature) {
      return;
    }

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
    clearScheduledSynthesis();
    cancelSynthesisRequest(activeSynthesisRequest);
    activeSynthesisRequest = null;
    unlistenSynthesis?.();
  });

  const synthStateText = () => {
    if (currentText().query === null || currentPreset() === null) {
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

  return (
    <div class="py-1.5">
      <div
        class="flex flex-col relative px3 pb1 b-l-2 b-slate-2 dark:b-slate-6 bg-white dark:bg-slate-8"
        classList={{ " !border-primary-5 shadow-md": selected() }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* The jupyter/Google Colab notebook style code block */}
        <div
          class="sticky flex h-0 top-5 bg-transparent pointer-events-none z-10"
          onMouseEnter={() => setToolbarHovered(true)}
          onMouseLeave={() => setToolbarHovered(false)}
        >
          <Show when={selected() || hovered() || toolbarHovered()}>
            <div
              class="absolute right-0 flex p1 rounded-lg bg-white dark:bg-slate-7 shadow-md -top-5 pointer-events-auto z-10"
              classList={{
                "opacity-50": hovered() && !selected() && !toolbarHovered(),
              }}
            >
              <EditButton edit={addTextBelow}>
                <div class="i-lucide:plus w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton edit={saveAudio} disable={!saveable()}>
                <div class="i-lucide:save w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton edit={moveUp} disable={props.index === 0}>
                <div class="i-lucide:chevron-up w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton
                edit={moveDown}
                disable={props.index === textStore.length - 1}
              >
                <div class="i-lucide:chevron-down w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton edit={remove}>
                <div class="i-lucide:trash2 w-full h-full group-hover:bg-red-5 group-active:bg-red-6" />
              </EditButton>
            </div>
          </Show>
        </div>
        <div
          class="flex flex-row items-start justify-center pt-sm"
          onFocus={() => setSelected(props.index)}
        >
          <AutogrowInput
            text={currentText().text}
            setText={setText}
            focused={selected()}
            placeholder={t1("text_block.input_label")}
            aria-label={t1("text_block.input_label")}
            onFocus={() => setSelected(props.index)}
          />
        </div>
        <div
          class="flex flex-row flex-1 w-full"
          onClick={() => setSelected(props.index)}
        >
          <div class="flex-1 pointer-events-none" />
          <div class="text-sm text-slate-8 dark:text-slate-2 select-none pointer-events-none">
            <Show
              when={currentPresetStyle() !== null && currentPreset()}
              fallback={
                <p class="text-yellow-7">{t1("preset.no_preset_selected")}</p>
              }
            >
              <p>{currentPreset()?.name}</p>
            </Show>
          </div>
          <Show when={config.ui_config.buffer_render}>
            <output
              aria-label={synthStateText()}
              class="ml-2 flex size-5 items-center justify-center rounded-full border border-slate-2 bg-slate-1/80 text-slate-5 shadow-sm dark:(border-slate-6 bg-slate-8/80 text-slate-4)"
              classList={{
                "opacity-60": !selected(),
                "!border-amber-2 !bg-amber-1/70 !text-amber-7 dark:(!border-amber-8/60 !bg-amber-9/20 !text-amber-4)":
                  selected() && synthState() === "Queued",
                "!border-sky-2 !bg-sky-1/70 !text-sky-7 dark:(!border-sky-8/60 !bg-sky-9/20 !text-sky-4)":
                  selected() && synthState() === "Running",
                "!border-emerald-2 !bg-emerald-1/70 !text-emerald-7 dark:(!border-emerald-8/60 !bg-emerald-9/20 !text-emerald-4)":
                  selected() && synthState() === "Completed",
                "!border-rose-2 !bg-rose-1/70 !text-rose-7 dark:(!border-rose-8/60 !bg-rose-9/20 !text-rose-4)":
                  selected() && synthState() === "Failed",
              }}
              title={synthStateText()}
            >
              <span
                aria-hidden="true"
                class={`size-3 ${synthStateIcon()}`}
                classList={{
                  "animate-spin": synthState() === "Running",
                }}
              />
            </output>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default TextBlock;
