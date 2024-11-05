# VOICEVOX Core Wrapper

This mod provides a (not really) safe wrapper around the VOICEVOX core. It is generated with `bindgen`, check [here](./binding/README.md) for more information.

The wrapper is yet not thread safe. It depends on an external synchronization mechanism, which, in this case, is `tauri`'s `StateManager`. If you are to use it outside, you need to provide your own synchronization mechanism.
