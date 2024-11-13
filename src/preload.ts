import { commands } from "./binding";
import { useMetaStore } from "./store/meta";

const useCoreInitialization = () => {
  const { setMetas } = useMetaStore()!;

  const initializeCore = async () => {
    const corePath = await commands.getCorePath();
    if (corePath.status === "ok") {
      try {
        await commands.initialize(corePath.data!, 1024);
        const newMetas = await commands.getMetas();
        if (newMetas.status === "ok") {
          setMetas(newMetas.data);
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      console.error(corePath.error);
    }
  };

  return { initializeCore };
};

export default useCoreInitialization;
