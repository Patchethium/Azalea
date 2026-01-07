import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";
import { commands, OS } from "../binding";

type SystemStoreType = {
  os: OS;
};

const [SystemProvider, useSystemStore] = createContextProvider(() => {
  const [systemStore, setSystemStore] = createStore<SystemStoreType>({
    os: "Linux",
  });

  commands.getOs().then((os) => {
    setSystemStore({ os });
  });

  return {
    systemStore,
  };
});

export { SystemProvider, useSystemStore };
export type { SystemStoreType };
