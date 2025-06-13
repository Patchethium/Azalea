import _ from "lodash";
import { AudioQuery, Preset } from "./binding";


export function getModifiedQuery(
  query: AudioQuery,
  preset: Preset,
): AudioQuery {
  const newQuery = _.cloneDeep(query);
  newQuery.pitch_scale = preset.pitch;
  newQuery.speed_scale = preset.speed / 100.0;
  newQuery.intonation_scale = preset.intonation;
  newQuery.volume_scale = preset.volume;
  newQuery.pre_phoneme_length = preset.start_slience / 1000.0;
  newQuery.post_phoneme_length = preset.end_slience / 1000.0;
  return newQuery;
}
