// The store that holds the available style metadata
import { createContextProvider } from "@solid-primitives/context";
import _ from "lodash";
import { createStore } from "solid-js/store";
import { CharacterMeta } from "../binding";

const [MetaProvider, useMetaStore] = createContextProvider(() => {
  const [metas, _setMetas] = createStore<CharacterMeta[]>([]);
  const setMetas = (newMetas: CharacterMeta[]): undefined | Error => {
    // don't accept new metas if we already have some, it's read-only
    if (metas.length === 0) {
      // combine all styles for metas with the same speaker_uuid
      const combinedMetas: CharacterMeta[] = [];
      newMetas.forEach((newMeta) => {
        const existingMetaIndex = combinedMetas.findIndex(
          (meta) => meta.speaker_uuid === newMeta.speaker_uuid,
        );
        if (existingMetaIndex !== -1) {
          // combine styles
          combinedMetas[existingMetaIndex].styles = [
            ...combinedMetas[existingMetaIndex].styles,
            ...newMeta.styles,
          ];
        } else {
          combinedMetas.push(newMeta);
        }
      });
      // sort styles by id for each meta
      combinedMetas.forEach((meta) => {
        meta.styles.sort((a, b) => (a.id < b.id ? -1 : 1));
      });
      _setMetas(combinedMetas);
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
