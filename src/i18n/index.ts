import { Locale } from "@binding";
import * as i18n from "@solid-primitives/i18n";
import _ from "lodash";
import * as en_dict from "./en.json";
import * as ja_dict from "./ja.json";
import * as zh_cn_dict from "./zh-CN.json";

export type RawDict = typeof en_dict;

export const en: RawDict = en_dict;
export const ja: RawDict = ja_dict;
export const zhCn: RawDict = zh_cn_dict;

export type Dict = i18n.Flatten<RawDict>;

function _getDict(locale: Locale): RawDict {
  switch (locale) {
    case "En":
      return en;
    case "Ja":
      return ja;
    case "ZhCn":
      return zhCn;
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
  ZhCn: getCoverage(zhCn, en),
};

const localeNames: Record<Locale, string> = {
  En: "English",
  Ja: "日本語",
  ZhCn: "简体中文",
};

const possibleLocales: Locale[] = ["En", "Ja", "ZhCn"];

function mergeDict(primary: unknown, fallback: RawDict): RawDict {
  return _.merge({}, fallback, primary);
}

function getDict(locale: Locale, fallback?: Locale): Dict {
  const primary = _getDict(locale);
  const fallbackDict = fallback ? _getDict(fallback) : en;
  const merged = mergeDict(primary, fallbackDict);
  return i18n.flatten(merged);
}

export { getDict, coverages, localeNames, possibleLocales };
