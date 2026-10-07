import { Button } from "@kobalte/core/button";
import { type JSX, splitProps } from "solid-js";

export function AppButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <Button
      type="button"
      {...rest}
      class={`rounded-md b b-slate-2 bg-transparent px3 py2 text-sm outline-none hover:(b-primary-5 bg-primary-5 text-white) focus-visible:ring-2 focus-visible:ring-primary-3 disabled:(cursor-not-allowed opacity-50) dark:b-slate-6 ${local.class ?? ""}`}
    />
  );
}
