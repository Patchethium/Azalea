import _ from "lodash";
import { AudioQuery, Preset } from "./binding";

const EPISILON = 1e-4;

export function getModifiedQuery(
  query: AudioQuery,
  preset: Preset,
): AudioQuery {
  const newQuery = _.cloneDeep(query);
  const pitch_shift = preset.pitch;
  const speed = preset.speed / 100;
  const pause_scale = preset.pause_scale / 100;
  const pause_scale_enabled = preset.pause_scale_enabled;
  newQuery?.accent_phrases.forEach((ap) => {
    if (ap.pause_mora != null) {
      if (pause_scale_enabled) {
        ap.pause_mora.vowel_length /= pause_scale;
      } else {
        ap.pause_mora.vowel_length /= speed;
      }
    }
    ap.moras.forEach((mora) => {
      if (mora.pitch > EPISILON) {
        mora.pitch += pitch_shift;
      }
      mora.vowel_length /= speed;
      if (mora.consonant_length != null) {
        mora.consonant_length /= speed;
      }
    });
  });
  return newQuery;
}
