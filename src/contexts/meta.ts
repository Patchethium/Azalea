// The store that holds the available style metadata
import { createContextProvider } from "@solid-primitives/context";
import _ from "lodash";
import { createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import {
  CharacterMeta,
  type SpeakerIconRequest,
  type SpeakerIconResult,
} from "../binding";

function speakerIconKey(request: SpeakerIconRequest) {
  return JSON.stringify([request.speaker_uuid, request.style_id]);
}

function dataUrlToObjectUrl(dataUrl: string) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/.exec(dataUrl);
  if (match === null) throw new Error("Invalid speaker icon data URL");

  const [, mimeType, base64Marker, payload] = match;
  const blob =
    base64Marker === undefined
      ? new Blob([decodeURIComponent(payload)], { type: mimeType })
      : (() => {
          const binary = atob(payload);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }
          return new Blob([bytes], { type: mimeType });
        })();
  return URL.createObjectURL(blob);
}

const [MetaProvider, useMetaStore] = createContextProvider(() => {
  const [metas, _setMetas] = createStore<CharacterMeta[]>([]);
  const [speakerIconUrls, setSpeakerIconUrls] = createSignal<
    ReadonlyMap<string, string>
  >(new Map());
  const [hydratedSpeakerIconKeys, setHydratedSpeakerIconKeys] = createSignal<
    ReadonlySet<string>
  >(new Set());
  const [allSpeakerIconsHydrated, setAllSpeakerIconsHydrated] =
    createSignal(false);
  const [speakerIconRevision, setSpeakerIconRevision] = createSignal(0);

  const revokeObjectUrls = (urls: Iterable<string>) => {
    for (const url of urls) URL.revokeObjectURL(url);
  };

  const speakerIconUrl = (request: SpeakerIconRequest) =>
    speakerIconUrls().get(speakerIconKey(request));

  const speakerIconsAreHydrated = (requests: SpeakerIconRequest[]) =>
    allSpeakerIconsHydrated() ||
    requests.every((request) =>
      hydratedSpeakerIconKeys().has(speakerIconKey(request)),
    );

  const storeSpeakerIcons = (
    requests: SpeakerIconRequest[],
    results: SpeakerIconResult[],
    expectedRevision: number,
  ) => {
    if (expectedRevision !== speakerIconRevision()) return false;

    const requestsBySpeaker = new Map(
      requests.map((request) => [request.speaker_uuid, request]),
    );
    const pendingUrls = new Map<string, string>();
    try {
      for (const result of results) {
        const request = requestsBySpeaker.get(result.speaker_uuid);
        if (request !== undefined && result.data_url !== null) {
          pendingUrls.set(
            speakerIconKey(request),
            dataUrlToObjectUrl(result.data_url),
          );
        }
      }
    } catch (error) {
      revokeObjectUrls(pendingUrls.values());
      throw error;
    }

    if (expectedRevision !== speakerIconRevision()) {
      revokeObjectUrls(pendingUrls.values());
      return false;
    }

    const nextUrls = new Map(speakerIconUrls());
    const urlsToRevoke: string[] = [];
    const resultsBySpeaker = new Map(
      results.map((result) => [result.speaker_uuid, result]),
    );
    for (const request of requests) {
      const key = speakerIconKey(request);
      const result = resultsBySpeaker.get(request.speaker_uuid);
      if (result?.data_url === null) {
        const previousUrl = nextUrls.get(key);
        if (previousUrl !== undefined) urlsToRevoke.push(previousUrl);
        nextUrls.delete(key);
        continue;
      }

      const nextUrl = pendingUrls.get(key);
      if (nextUrl !== undefined) {
        const previousUrl = nextUrls.get(key);
        if (previousUrl !== undefined) urlsToRevoke.push(previousUrl);
        nextUrls.set(key, nextUrl);
      }
    }

    setSpeakerIconUrls(nextUrls);
    setHydratedSpeakerIconKeys((current) => {
      const next = new Set(current);
      for (const request of requests) next.add(speakerIconKey(request));
      return next;
    });
    revokeObjectUrls(urlsToRevoke);
    return true;
  };

  const hydrateSpeakerIcons = (
    requests: SpeakerIconRequest[],
    results: SpeakerIconResult[],
    expectedRevision: number,
  ) => storeSpeakerIcons(requests, results, expectedRevision);

  const mergeSpeakerIcons = (
    requests: SpeakerIconRequest[],
    results: SpeakerIconResult[],
    expectedRevision: number,
  ) => storeSpeakerIcons(requests, results, expectedRevision);

  const removeSpeakerIcon = (request: SpeakerIconRequest) => {
    const key = speakerIconKey(request);
    const url = speakerIconUrls().get(key);
    if (url === undefined) return;

    const nextUrls = new Map(speakerIconUrls());
    nextUrls.delete(key);
    setSpeakerIconUrls(nextUrls);
    setSpeakerIconRevision((revision) => revision + 1);
    URL.revokeObjectURL(url);
  };

  const clearSpeakerIcons = () => {
    const urls = speakerIconUrls();
    setSpeakerIconUrls(new Map());
    setAllSpeakerIconsHydrated(true);
    setSpeakerIconRevision((revision) => revision + 1);
    revokeObjectUrls(urls.values());
  };
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
            ..._.cloneDeep(newMeta.styles),
          ];
        } else {
          combinedMetas.push(_.cloneDeep(newMeta));
        }
      });
      // sort styles by id for each meta
      combinedMetas.forEach((meta) => {
        meta.styles.sort((a, b) => (a.id < b.id ? -1 : 1));
      });
      combinedMetas.sort((a, b) => a.styles[0].id - b.styles[0].id);
      _setMetas(combinedMetas);
    } else {
      return new Error("Metas are read-only and we already have some");
    }
  };
  const availableStyleIds = () =>
    _.flattenDeep(metas.map((meta) => meta.styles.map((style) => style.id)));

  onCleanup(() => revokeObjectUrls(speakerIconUrls().values()));

  return {
    metas,
    setMetas,
    availableStyleIds,
    speakerIconRevision,
    speakerIconUrl,
    speakerIconsAreHydrated,
    hydrateSpeakerIcons,
    mergeSpeakerIcons,
    removeSpeakerIcon,
    clearSpeakerIcons,
  };
});

export { MetaProvider, useMetaStore };
