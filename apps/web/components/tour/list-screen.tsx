import { MY_LIST } from "./tour-data";
import { Phone } from "./phone";

export function ListScreen() {
  return (
    <Phone title="My list">
      <div className="grid grid-cols-2 gap-3">
        {MY_LIST.map((g) => (
          <div key={g.name} className="flex flex-col gap-1 rounded-lg border p-2">
            <span data-testid="gift-thumb" className="grid aspect-[4/3] place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
              <g.icon className="size-8" />
            </span>
            <span className="text-[14px] font-semibold">{g.name}</span>
            <span className="text-[14px] font-semibold tabular-nums">{g.price}</span>
          </div>
        ))}
      </div>
      <span className="self-start rounded-lg bg-secondary px-4 py-2.5 text-[15px] font-semibold text-secondary-foreground">
        Share my list
      </span>
    </Phone>
  );
}
