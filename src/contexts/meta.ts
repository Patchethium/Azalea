// The store that holds the available style metadata
import { createContextProvider } from "@solid-primitives/context";
import _ from "lodash";
import { createStore } from "solid-js/store";
import { SpeakerMeta } from "../binding";

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
  const availableStyleIds = () =>
    _.flattenDeep(metas.map((meta) => meta.styles.map((style) => style.id)));
  return {
    metas,
    setMetas,
    availableStyleIds,
  };
});

export { MetaProvider, useMetaStore };
