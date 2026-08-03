import type { OwnerSide } from "@/lib/plans/types";

const SIDES: readonly OwnerSide[] = ["seller", "buyer"];
const SIDE_LABEL: Record<OwnerSide, string> = { seller: "Seller", buyer: "Buyer" };

interface OwnerToggleProps {
  name: string;
  defaultValue: OwnerSide;
  idPrefix: string;
}

/**
 * The core seller/buyer differentiator (T29-6). An unmistakable visible
 * toggle, never a dropdown: two real radio inputs (keyboard-operable, screen-
 * reader-correct out of the box, works without client JS for progressive
 * enhancement) styled as a segmented pill. Selected state uses the side's
 * tint/marker tokens — identity "whispers" per the design system, never
 * Signal.
 */
export function OwnerToggle({ name, defaultValue, idPrefix }: OwnerToggleProps) {
  return (
    <div className="plan-owner-toggle" role="radiogroup" aria-label="Owner">
      {SIDES.map((side) => {
        const inputId = `${idPrefix}-owner-${side}`;
        return (
          <span key={side} className="plan-owner-option" data-side={side}>
            <input
              type="radio"
              id={inputId}
              name={name}
              value={side}
              defaultChecked={defaultValue === side}
              className="plan-owner-input"
            />
            <label htmlFor={inputId} className="plan-owner-label">
              {SIDE_LABEL[side]}
            </label>
          </span>
        );
      })}
    </div>
  );
}
