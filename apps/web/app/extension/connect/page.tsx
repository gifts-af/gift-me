import { Account } from "@/components/app-shell/account";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { createExtensionToken } from "./actions";
import { ConnectClient } from "./connect-client";

// Signed-in only: the proxy sends signed-out visitors to sign in and back.
export default function ExtensionConnectPage() {
  return (
    <>
      <TopBar back={{ href: "/", label: "Home" }} account={<Account />} />
      <PageFrame>
        <PageTitle>Connect the extension</PageTitle>
        <ConnectClient action={createExtensionToken} />
      </PageFrame>
    </>
  );
}
