import { IconButton } from "@components/iconButton";
import type { ParentProps } from "solid-js";
import { usei18n } from "../../contexts/i18n";

interface ConfigItemProps extends ParentProps {
  label: string;
  experimental?: boolean;
  nested?: boolean;
}

export function ConfigItem(props: ConfigItemProps) {
  const { t1 } = usei18n()!;
  return (
    <div
      class="wfull items-center justify-center flex flex-row p2 b-b b-slate-2 dark:b-slate-7 select-none cursor-default"
      classList={{ "pl-6": props.nested }}
    >
      {props.nested && (
        <div
          aria-hidden="true"
          class="i-lucide:corner-down-right mr-1 size-4 shrink-0 text-slate-4 dark:text-slate-5"
        />
      )}
      {props.label}
      {props.experimental && (
        <IconButton
          icon="i-lucide:flask-conical"
          label={t1("config.experimental")}
          size="sm"
          class="ml-1"
        />
      )}
      <div class="flex-1" />
      {props.children}
    </div>
  );
}
