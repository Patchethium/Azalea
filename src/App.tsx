import { createSignal, onMount } from "solid-js";
import { AudioQuery } from "./binding/AudioQuery";
import { invoke } from "@tauri-apps/api/core";
import { Select } from "@kobalte/core/select";
import { Button } from "@kobalte/core/button";
import { SpeakerMeta } from "./binding/SpeakerMeta";
import { StyleMeta } from "./binding/StyleMeta";
import { StyleId } from "./binding/StyleId";
import { TextField } from "@kobalte/core/text-field";

function App() {
  const [text, setText] = createSignal("こんにちは、ボイスボックス。");
  const [metas, setMetas] = createSignal<SpeakerMeta[]>([]);
  const [audio_query, setAudioQuery] = createSignal<AudioQuery>();
  const [audio_data, setAudioData] = createSignal<Uint8Array>();
  const [selected_style_id, setSelectedStyleId] = createSignal<StyleId>();

  const query = (text: string, style_id: StyleId) => {
    // do nothing if text or style_id is undefined
    if (text.length === 0 || selected_style_id() === undefined) {
      return;
    }
    invoke("encode", { text, speakerId: style_id }).then((query) => {
      setAudioQuery(query as AudioQuery);
    });
  };

  const speak = (query: AudioQuery, style_id: StyleId) => {
    // do nothing if audio_query or style_id is undefined
    if (audio_query() === undefined || selected_style_id() === undefined) {
      return;
    }
    invoke("decode", { audioQuery: query, speakerId: style_id }).then(
      (data) => {
        setAudioData(data as Uint8Array);
        // invoke("play_audio", { waveform: data });
      }
    );
  };

  onMount(() => {
    invoke("get_metas").then((metas) => {
      let metas_sanity = metas as SpeakerMeta[];
      metas_sanity.forEach((m) => {
        m.styles = m.styles.filter((s) => s.type === "talk");
      });
      setMetas(metas_sanity);
    });
  });

  return (
    <main class="h-full w-full absolute left-0 right-0 flex flex-col p3">
      <div class="font-bold">VOICEVOX Tauri Demo</div>
      <div class="flex flex-row gap-3 p3 items-center">
        <TextField>
          <TextField.Input
            class="h-8 w-128 p-2 rounded-md border-1 border-gray focus:ring-blue-5 focus:ring-1 focus:border-white"
            value={text()}
            placeholder="Enter text here"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
        </TextField>
        <Button
          onClick={() => {}}
          class="w-auto bg-blue-5 p-2 color-white rounded-md hover:bg-blue-6 active:bg-blue-7 disabled:bg-gray-3 disabled:color-gray-5 disabled:hover:cursor-not-allowed"
          disabled={text().length === 0}
          onclick={() => query(text(), selected_style_id() ?? 0)}
        >
          Query
        </Button>
        <Button
          onClick={() => {}}
          class="w-auto bg-blue-5 p-2 color-white rounded-md hover:bg-blue-6 active:bg-blue-7 disabled:bg-gray-3 disabled:color-gray-5 disabled:hover:cursor-not-allowed"
          disabled={audio_query() === undefined}
          onclick={() => speak(audio_query()!, selected_style_id() ?? 0)}
        >
          Speak
        </Button>
      </div>
      <div>
        Selected Speaker:
        {metas().find(
          (m) =>
            m.styles.find((s) => s.id === selected_style_id()) !== undefined
        )?.name ?? "None"}
      </div>
      <div>Selected style id: {selected_style_id()}</div>
      <Select<StyleMeta, SpeakerMeta>
        options={metas()}
        optionValue="id"
        optionTextValue="name"
        optionGroupChildren="styles"
        placeholder="Select a Style"
        itemComponent={(props) => (
          <Select.Item item={props.item} class="px-4 py-2 hover:bg-gray-100">
            <Select.ItemLabel>{props.item.rawValue.name}</Select.ItemLabel>
          </Select.Item>
        )}
        sectionComponent={(props) => (
          <Select.Section class="px-4 py-1 text-gray-500 font-medium">
            {props.section.rawValue.name}
          </Select.Section>
        )}
        onChange={(value) => setSelectedStyleId(value?.id)}
      >
        <Select.Trigger
          aria-label="Style"
          class="w-64 px-4 py-2 border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring focus:ring-blue-500"
        >
          <Select.Value<StyleMeta>>
            {(state) => state.selectedOption()?.name || "Select a Style"}
          </Select.Value>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content class="mt-2 w-auto max-h-60 overflow-auto bg-white border border-gray-200 rounded-md shadow-lg">
            <Select.Listbox class="divide-y divide-gray-100" />
          </Select.Content>
        </Select.Portal>
      </Select>

      <details>
        <summary>Audio Query</summary>
        <div>{JSON.stringify(audio_query() ?? {})}</div>
      </details>

      <div>
        <Button
          onClick={() => {
            console.log(metas());
          }}
          class="w-auto bg-blue-5 p-2 color-white rounded-md hover:bg-blue-6 active:bg-blue-7 disabled:bg-gray-3"
        >
          Log Metas
        </Button>
      </div>
    </main>
  );
}

export default App;
