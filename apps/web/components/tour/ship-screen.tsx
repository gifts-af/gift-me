import { Phone, Row } from "./phone";

const options = [
  { title: "Mom's address", note: "Shared through her list · Dayton, OH", selected: true },
  { title: "My address", note: "44 Elm St, Columbus, OH", selected: false },
  { title: "Another address", note: "A party, an office, a neighbour", selected: false },
];

export function ShipScreen() {
  return (
    <Phone title="Where should it go?">
      {options.map((o) => (
        <Row key={o.title} selected={o.selected}>
          <span
            aria-hidden="true"
            className={`size-5 flex-none rounded-full border-2 ${o.selected ? "border-primary bg-primary" : "border-input"}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{o.title}</span>
            <span className="block text-[13px] text-muted-foreground">{o.note}</span>
          </span>
        </Row>
      ))}
    </Phone>
  );
}
