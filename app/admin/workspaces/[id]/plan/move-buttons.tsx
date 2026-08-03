// Shared move-up/move-down control (T29-4). Buttons, not drag-and-drop:
// keyboard-navigable, one action per press. "up" is disabled on the first
// item and "down" on the last, and each button's accessible name states
// exactly what it moves — required for a screen-reader user to act on a
// list of otherwise-identical "move up"/"move down" buttons.

interface MoveButtonsProps {
  itemLabel: string;
  isFirst: boolean;
  isLast: boolean;
  isPending: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function MoveButtons({ itemLabel, isFirst, isLast, isPending, onMoveUp, onMoveDown }: MoveButtonsProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Reorder ${itemLabel}`}>
      <button
        type="button"
        className="plan-btn plan-btn--icon"
        onClick={onMoveUp}
        disabled={isFirst || isPending}
        aria-label={`Move '${itemLabel}' up`}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        className="plan-btn plan-btn--icon"
        onClick={onMoveDown}
        disabled={isLast || isPending}
        aria-label={`Move '${itemLabel}' down`}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </div>
  );
}
