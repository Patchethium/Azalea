# VOICEVOX Core Binding

We include a pre-built binding, if you want to re-generate it, do

```bash
cargo install bindgen-cli

cd voicevox_core/ # go to where you place your version of voicevox_core

bindgen --dynamic-loading VoicevoxCore voicevox_core.h > voicevox_core.rs

mv voicevox_core.rs path_to_voicevox_sys/voicevox_core.rs # replace the path to your own
```

If you changed the platform, you may need to regenerate the binding. The pre-built binding is on Arch Linux AMD64.
