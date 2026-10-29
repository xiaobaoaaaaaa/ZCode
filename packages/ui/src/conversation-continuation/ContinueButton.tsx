import { PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";

export function ContinueButton({
  label,
  disabled,
  pending,
  onClick,
}: {
  label: string;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <ControlHintTooltip title={label}>
      <Button
        type="button"
        size="icon-md"
        disabled={disabled}
        onClick={onClick}
        data-testid="v4-composer-continue"
        aria-label={label}
        className="cursor-pointer rounded-lg bg-brand text-foreground-inverse hover:bg-brand/80 focus-visible:ring-2 focus-visible:ring-input-border-focused"
      >
        {pending ? <Spinner className="size-4" /> : <PlayIcon className="size-4 fill-current" />}
      </Button>
    </ControlHintTooltip>
  );
}
