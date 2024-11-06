// The store that holds the avaliable style metadata
import { createContextProvider } from "@solid-primitives/context";
import { SpeakerMeta } from "../types/SpeakerMeta";
import { createStore } from "solid-js/store";
import _ from "lodash";

const [MetaProvider, useMetaStore] = createContextProvider(() => {
  const [metas, _setMetas] = createStore<SpeakerMeta[]>([]);
  const setMetas = (newMetas: SpeakerMeta[]): undefined | Error => {
    // don't accept new metas if we already have some, it's read-only
    if (metas.length === 0) {
      _setMetas(newMetas);
    } else {
      return new Error("Metas are read-only and we already have some");
    }
  };
  const availableSpeakerIds = () =>
    _.flattenDeep(metas.map((meta) => meta.styles.map((style) => style.id)));
  return {
    metas,
    setMetas,
    availableSpeakerIds,
  };
});

export { MetaProvider, useMetaStore };
