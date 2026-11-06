import { Account } from "./account";
import { ProductTabs, type ProductTab } from "./product-tabs";

// What fills the top bar's slot on a signed-in page.
export function AppNav({ current }: { current?: ProductTab }) {
  return (
    <>
      <ProductTabs current={current} />
      <div className="ml-auto">
        <Account />
      </div>
    </>
  );
}
