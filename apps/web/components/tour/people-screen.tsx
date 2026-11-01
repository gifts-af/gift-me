import { PEOPLE } from "./tour-data";
import { Phone, Row } from "./phone";

export function PeopleScreen() {
  return (
    <Phone title="People">
      {PEOPLE.map((p) => (
        <Row key={p.name}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{p.name}</span>
            <span className="block text-[13px] text-muted-foreground">{p.occasion}</span>
            <span className="block text-[13px] font-semibold text-accent-foreground">{p.source}</span>
          </span>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[12px] font-semibold text-accent-foreground">{p.status}</span>
        </Row>
      ))}
    </Phone>
  );
}
