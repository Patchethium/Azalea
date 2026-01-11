# Roadmap

## Release 0.1.0

- [x] pitch range refreshing / adaptation
- [ ] compile&release w/ GitHub action
- [ ] preset manager
- [ ] multiple selection
- [ ] DnD
- [x] UI state persist
- [ ] silent saving for audio
- [x] background buffering for audio generation
  - [ ] optimize the polling strategy, for now the performance is not ideal
  - [ ] FIX: the pitch editing doesn't trigger re-synthesis
- [ ] spectrogram view with overlay canvas for pitch/duration editing
- [ ] accent phrase manipulation
- [ ] FIX: audio query got refreshed when changing preset, this is usually not desired
- Reason: we use effect watching textBlock which includeds a preset id, which refreshes audio query accrordingly.
