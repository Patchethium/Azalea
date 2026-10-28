import { Switch } from "@kobalte/core/switch";

/** The on/off control of a setting row; `label` names it for assistive tech. */
export function AppSwitch(props: {
  label: string;
  checked?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      checked={props.checked}
      disabled={props.disabled}
      onChange={(value) => props.onChange(value)}
      class="inline-flex cursor-pointer select-none items-center justify-center ui-disabled:(cursor-not-allowed opacity-50)"
    >
      <Switch.Input aria-label={props.label} class="peer" />
      <Switch.Control class="h-6 w-12 rounded-full bg-control-off p1 ui-checked:bg-accent peer-focus-visible:(ring-2 ring-focus-ring)">
        <Switch.Thumb class="size-4 rounded-full bg-white ui-checked:translate-x-6 motion-safe:(transition-transform duration-200)" />
      </Switch.Control>
    </Switch>
  );
}
