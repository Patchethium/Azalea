import * as i18n from "@solid-primitives/i18n";
import _ from "lodash";
import * as en_dict from "./en.json";
import * as ja_dict from "./ja.json";

import { Locale } from "../binding";

export type RawDict = typeof en_dict;

export const en: RawDict = en_dict;
export const ja: RawDict = ja_dict;

export type Dict = i18n.Flatten<RawDict>;

function _getDict(locale: Locale): RawDict {
  switch (locale) {
    case "En":
      return en;
    case "Ja":
      return ja;
  }
}

function getCoverage(merged: RawDict, primary: RawDict): number {
  const primaryKeys = Object.keys(primary);
  const mergedKeys = Object.keys(merged);
  const commonKeys = _.intersection(primaryKeys, mergedKeys);
  return commonKeys.length / primaryKeys.length;
}

const coverages = {
  En: 1.0, // English is the primary language
  Ja: getCoverage(ja, en),
};

const localeNames: Record<Locale, string> = {
  En: "English",
  Ja: "日本語",
};

const possibleLocales: Locale[] = ["En", "Ja"];

function mergeDict(primary: unknown, fallback: RawDict): RawDict {
  const primary_len = Object.keys(primary as object).length;
  const fallback_len = Object.keys(fallback).length;
  if (primary_len === fallback_len) {
    return primary as RawDict;
  }
  return _.merge({}, fallback, primary);
}

function getDict(locale: Locale, fallback?: Locale): Dict {
  const primary = _getDict(locale);
  const fallbackDict = fallback ? _getDict(fallback) : en;
  const merged = mergeDict(primary, fallbackDict);
  return i18n.flatten(merged);
}

export { getDict, coverages, localeNames, possibleLocales };
