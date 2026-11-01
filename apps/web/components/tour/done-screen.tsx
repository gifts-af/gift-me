import { Phone } from "./phone";

export function DoneScreen() {
  return (
    <Phone title="Mom's birthday">
      <span className="self-start rounded-full bg-success-soft px-2.5 py-1 text-[13px] font-bold text-success">On its way</span>
      <p className="text-[17px] font-bold">Ordered. (Not really, this is the tour.)</p>
      <p className="text-[15px] text-muted-foreground">
        It arrives Thursday, two days early. Mom never sees what you spent.
      </p>
    </Phone>
  );
}
