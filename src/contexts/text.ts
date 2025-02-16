// The store that holds the text block data
import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";
import { AudioQuery, Preset } from "../binding";

type TextBlockProps = Omit<Preset, "name"> & {
  name: string | null;
  text: string;
  query?: AudioQuery;
};

const [TextProvider, useTextStore] = createContextProvider(
  (props: { value: TextBlockProps[] }) => {
    const [textStore, setTextStore] = createStore<TextBlockProps[]>(
      props.value,
    );
    return {
      textStore,
      setTextStore,
    };
  },
);

export { TextProvider, useTextStore };
export type { TextBlockProps };
