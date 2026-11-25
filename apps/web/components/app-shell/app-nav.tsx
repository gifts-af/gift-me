import { Account } from "./account";
import { ProductTabs, type ProductTab } from "./product-tabs";
import { RememberHomeTab } from "./remember-home-tab";

// What fills the top bar's slot on a signed-in page.
export function AppNav({ current }: { current?: ProductTab }) {
  return (
    <>
      <ProductTabs current={current} />
      {current && <RememberHomeTab tab={current} />}
      <div className="ml-auto">
        <Account />
      </div>
    </>
  );
}
