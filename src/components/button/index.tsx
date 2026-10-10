import { Button } from "@kobalte/core/button";
import { type JSX, splitProps } from "solid-js";

interface AppButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary";
}

const variants = {
  default:
    "b b-slate-2 bg-transparent hover:(b-primary-5 bg-primary-5 text-white) dark:b-slate-6",
  primary:
    "b b-primary-5 bg-primary-5 font-medium text-white hover:(b-primary-6 bg-primary-6)",
};

export function AppButton(props: AppButtonProps) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <Button
      type="button"
      {...rest}
      class={`rounded-md px3 py2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-3 disabled:(cursor-not-allowed opacity-50) ${variants[local.variant ?? "default"]} ${local.class ?? ""}`}
    />
  );
}
