import * as commands from "./commands";
import { useMetaStore } from "./store/meta";

const useCoreInitialization = () => {
  const { setMetas } = useMetaStore()!;

  const initializeCore = async () => {
    const corePath = await commands.get_core_path();
    if (corePath !== "") {
      try {
        await commands.initialize_core(corePath, 1024);
        const newMetas = await commands.metas();
        if (newMetas !== undefined) {
          setMetas(newMetas);
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  return { initializeCore };
};

export default useCoreInitialization;
