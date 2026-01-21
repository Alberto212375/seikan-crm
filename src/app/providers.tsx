"use client";

import { CrmStoreProvider } from "./(crm)/_store/CrmStoreProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <CrmStoreProvider>{children}</CrmStoreProvider>;
}
